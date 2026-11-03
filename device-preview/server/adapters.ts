import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  qualityPresets,
  MAX_FRAME_BYTES,
  type InputAction,
  type OperationStatus,
  type Platform,
  type Quality,
} from "../shared/contracts.js";
import {
  parseAdbDevices,
  parseAvds,
  parseSimctlDevices,
  matchAndroidDevices,
  type ListedDevice,
  type AndroidInstance,
} from "./discovery.js";
import { command, launch, type OwnedProcess } from "./process.js";
import { FrameStore, JpegParser } from "./frames.js";
import { discoverTools, androidEndpoint, type Tools } from "./tools.js";
import { field, fields, grpc, imageBytes, type EmulatorEndpoint } from "./android-grpc.js";
import { createIosRuntime } from "./ios-runtime.js";
import { PreviewError } from "./errors.js";
import { screenRotation } from "../shared/geometry.js";

export interface DeviceList {
  devices: ListedDevice[];
  notes: string[];
}
export interface PreviewSession {
  controls: OperationStatus["controls"];
  prepare(): Promise<void>;
  input(action: InputAction): Promise<void>;
  check(): void;
  close(): Promise<void>;
}
export interface PreviewBackend {
  capabilities(): Promise<{
    android: { available: boolean; reason: string };
    ios: { available: boolean; reason: string };
  }>;
  list(platform: Platform, signal: AbortSignal): Promise<DeviceList>;
  open(
    platform: Platform,
    device: ListedDevice,
    quality: Quality,
    frames: FrameStore,
    signal: AbortSignal,
  ): PreviewSession;
}
const screenSchema = z.object({
  screen: z
    .object({
      width: z.number().positive().max(8192),
      height: z.number().positive().max(8192),
      orientation: z.enum([
        "portrait",
        "landscape-left",
        "portrait-upside-down",
        "landscape-right",
      ]),
      target: z.object({
        screenId: z.number().int().min(0).max(0xffffffff),
        litPanel: z.enum(["primary", "secondary"]).nullable(),
        pixelSize: z.object({
          width: z.number().int().positive().max(16384),
          height: z.number().int().positive().max(16384),
        }),
      }),
    })
    .passthrough(),
});
const ackSchema = z.object({ ok: z.boolean() });

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new PreviewError("无法准备模拟器端口"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}
function emulatorLaunch(tool: string, args: string[]) {
  // The emulator outlives preview. No stdin/stdout pipes or daemon-owned shutdown.
  const child = spawn(tool, args, {
    shell: false,
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  });
  child.on("error", () => {});
  child.unref();
}

export interface BackendOptions {
  detect?: typeof discoverTools;
  runCommand?: typeof command;
  endpoint?: typeof androidEndpoint;
}
export function createBackend(lifetime: AbortSignal, options: BackendOptions = {}): PreviewBackend {
  const detect = options.detect ?? discoverTools;
  const runCommand = options.runCommand ?? command;
  const findEndpoint = options.endpoint ?? androidEndpoint;
  let tools: Tools | null = null;
  const runtime = createIosRuntime();
  async function detected() {
    tools ??= await detect(lifetime);
    return tools;
  }
  async function androidList(signal: AbortSignal): Promise<DeviceList> {
    const sdk = (await detected()).android;
    if (!sdk) throw new PreviewError("主机未安装 Android SDK 的 adb 和 emulator");
    const avds = parseAvds((await runCommand(sdk.emulator, ["-list-avds"], { signal })).toString());
    const raw = (await runCommand(sdk.adb, ["devices"], { signal })).toString();
    const serials = parseAdbDevices(raw),
      instances: AndroidInstance[] = [];
    let unknown = false;
    for (const entry of serials) {
      let avd: string | null = null;
      if (entry.state === "device") {
        try {
          const output = (
            await runCommand(sdk.adb, ["-s", entry.serial, "emu", "avd", "name"], {
              signal,
              timeout: 3000,
            })
          ).toString();
          avd = output.split(/\r?\n/).find((line) => avds.includes(line)) ?? null;
        } catch {
          /* Unknown instances cannot be selected. */
        }
      }
      if (!avd) unknown = true;
      instances.push({ ...entry, avd });
    }
    const devices = matchAndroidDevices(avds, instances);
    for (const device of devices) {
      if (unknown && device.state === "shutdown") {
        device.state = "unavailable";
        device.reason = "存在身份未确认的运行实例，请等待就绪后刷新";
      }
      if (device.serial && !(await findEndpoint(device.id, device.serial))) {
        device.state = "unavailable";
        device.reason = "该实例未提供带认证的画面通道，请在模拟器中启用 gRPC token";
      }
    }
    return {
      devices,
      notes: [
        "仅展示已配置 AVD；物理设备和非 emulator 序列号已排除",
        "同一 AVD 的多个运行实例不会被选中",
      ],
    };
  }
  return {
    async capabilities() {
      tools = null;
      const found = await detected();
      let iosReason =
        "需要 Apple Silicon Mac、完整 Xcode 和已安装的 iOS runtime；首次预览下载约 35 MB 的校验组件";
      if (process.platform === "darwin" && process.arch !== "arm64")
        iosReason = "Intel Mac 不支持此原生预览组件";
      return {
        android: {
          available: !!found.android,
          reason: found.android
            ? "Android Emulator 原生画面流与触控"
            : "主机未找到 Android SDK 的 adb 和 emulator",
        },
        ios: { available: !!found.xcrun, reason: iosReason },
      };
    },
    async list(platform, requestSignal) {
      const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(20_000)]);
      if (platform === "android") return androidList(signal);
      const xcrun = (await detected()).xcrun;
      if (!xcrun) throw new PreviewError("此主机不支持 iOS 原生模拟器预览");
      const raw = await runCommand(xcrun, ["simctl", "list", "devices", "available", "--json"], {
        signal,
      });
      return {
        devices: parseSimctlDevices(JSON.parse(raw.toString())),
        notes: ["设备运行在所选主机；停止预览会保留设备运行"],
      };
    },
    open(platform, device, quality, frames, signal) {
      const controller = new AbortController();
      const joinedSignal = AbortSignal.any([signal, controller.signal]);
      const processes = new Set<OwnedProcess>();
      const tasks = new Set<Promise<unknown>>();
      const preset = qualityPresets[quality];
      let inputProcess: OwnedProcess | null = null;
      let endpoint: EmulatorEndpoint | null = null;
      let serial = device.serial;
      let screen: z.infer<typeof screenSchema>["screen"] | null = null;
      let binary: string | null = null;
      let streamError: Error | null = null;
      let inputTail: Promise<void> = Promise.resolve();
      let width = 0,
        height = 0;
      let contacts: Extract<InputAction, { type: "touch" }> | null = null;
      let pendingFrame: Buffer | null = null;
      let frameTimer: ReturnType<typeof setTimeout> | null = null;
      let lastFrameAt = 0;
      let preparationDeadline = Infinity;
      function publishAndroid(bytes: Buffer) {
        if (bytes.length > MAX_FRAME_BYTES) throw new PreviewError("画面超过大小上限，请降低画质");
        pendingFrame = Buffer.from(bytes);
        if (frameTimer) return;
        const wait = Math.max(0, 1000 / preset.fps - (Date.now() - lastFrameAt));
        frameTimer = setTimeout(() => {
          frameTimer = null;
          const next = pendingFrame;
          pendingFrame = null;
          if (!next || joinedSignal.aborted) return;
          try {
            frames.push(next, "image/png");
            lastFrameAt = Date.now();
          } catch (error) {
            streamError = error instanceof Error ? error : new PreviewError("画面格式无效");
          }
        }, wait);
      }
      const controls: OperationStatus["controls"] =
        platform === "ios"
          ? ["touch", "home", "recents", "appearance", "rotate"]
          : ["touch", "back", "home", "recents", "appearance"];
      async function run(tool: string, args: string[], timeout = 10_000) {
        const boundedTimeout = Math.min(timeout, preparationDeadline - Date.now());
        if (boundedTimeout <= 0) throw new PreviewError("设备准备超时，请检查主机状态后重试");
        const task = runCommand(tool, args, { signal: joinedSignal, timeout: boundedTimeout });
        tasks.add(task);
        try {
          return await task;
        } finally {
          tasks.delete(task);
        }
      }
      async function prepareAndroid() {
        const sdk = (await detected()).android;
        if (!sdk) throw new PreviewError("未找到 Android SDK");
        if (device.state === "shutdown") {
          const port = await freePort();
          joinedSignal.throwIfAborted();
          emulatorLaunch(sdk.emulator, [
            "-avd",
            device.id,
            "-no-window",
            "-no-audio",
            "-no-boot-anim",
            "-no-snapshot-save",
            "-grpc",
            String(port),
            "-grpc-use-token",
            "-no-metrics",
          ]);
        }
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline) {
          joinedSignal.throwIfAborted();
          const raw = (await run(sdk.adb, ["devices"])).toString();
          const matches: string[] = [];
          for (const entry of parseAdbDevices(raw)) {
            if (entry.state !== "device") continue;
            const name = (await run(sdk.adb, ["-s", entry.serial, "emu", "avd", "name"]))
              .toString()
              .split(/\r?\n/)[0];
            if (name === device.id) matches.push(entry.serial);
          }
          if (matches.length > 1) throw new PreviewError("同一个 AVD 存在多个运行实例，已拒绝连接");
          serial = matches[0] ?? null;
          if (serial) {
            endpoint = await findEndpoint(device.id, serial);
            const boot = (
              await run(sdk.adb, ["-s", serial, "shell", "getprop", "sys.boot_completed"])
            )
              .toString()
              .trim();
            if (endpoint && boot === "1") break;
          }
          await delay(1000, undefined, { signal: joinedSignal });
        }
        if (!endpoint || !serial) throw new PreviewError("模拟器准备超时，请检查设备后刷新");
        const size = (await run(sdk.adb, ["-s", serial, "shell", "wm", "size"])).toString();
        const dimensions = [...size.matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/g)].at(-1);
        if (!dimensions) throw new PreviewError("无法确认模拟器画面尺寸");
        width = Number(dimensions[1]);
        height = Number(dimensions[2]);
        const payload = Buffer.concat([field(1, 0), field(3, preset.edge), field(4, preset.edge)]);
        const stream = grpc(endpoint, "streamScreenshot", payload, {
          signal: joinedSignal,
          onData: (message) => {
            const format = fields(message).get(1)?.[0];
            if (!Buffer.isBuffer(format)) throw new PreviewError("画面缺少几何信息");
            const bytes = imageBytes(message);
            if (bytes) publishAndroid(bytes);
          },
        });
        trackStream(stream);
      }
      function trackStream(stream: Promise<unknown>) {
        const task = stream.catch((error: unknown) => {
          if (!joinedSignal.aborted)
            streamError = error instanceof Error ? error : new PreviewError("画面流已中断");
        });
        tasks.add(task);
        void task.finally(() => tasks.delete(task));
      }
      async function prepareIos() {
        const xcrun = (await detected()).xcrun;
        if (!xcrun) throw new PreviewError("此主机不支持 iOS 预览");
        binary = await runtime.ensure(joinedSignal);
        joinedSignal.throwIfAborted();
        if (device.state === "shutdown") await run(xcrun, ["simctl", "boot", device.id], 20_000);
        await run(xcrun, ["simctl", "bootstatus", device.id, "-b"], 120_000);
        screen = screenSchema.parse(
          JSON.parse((await run(binary, ["describe-ui", "--udid", device.id])).toString()),
        ).screen;
        width = screen.width;
        height = screen.height;
        frames.setRotation(screenRotation(screen.orientation));
        joinedSignal.throwIfAborted();
        inputProcess = launch(binary, [
          "input",
          "--udid",
          device.id,
          "--expected-screen",
          JSON.stringify(screen),
        ]);
        processes.add(inputProcess);
        const stream = launch(binary, [
          "stream",
          "--udid",
          device.id,
          "--format",
          "mjpeg",
          "--fps",
          String(preset.fps),
          "--quality",
          String(preset.jpeg),
          "--scale",
          String(preset.scale),
        ]);
        processes.add(stream);
        const parser = new JpegParser((bytes) => frames.push(bytes, "image/jpeg"));
        stream.child.stdout.on("data", (chunk: Buffer) => {
          try {
            parser.push(chunk);
          } catch (error) {
            streamError = error instanceof Error ? error : new PreviewError("画面格式无效");
            void stream.stop().catch(() => {});
          }
        });
        trackStream(
          stream.closed.then(() => {
            if (!joinedSignal.aborted) throw new PreviewError("iOS 原生画面流已结束，请重新连接");
            return;
          }),
        );
      }
      async function iosInput(envelope: Record<string, unknown>, requestSignal = joinedSignal) {
        const owned = inputProcess;
        if (!owned) throw new PreviewError("输入通道尚未就绪");
        await new Promise<void>((resolve, reject) => {
          let bytes = "",
            done = false;
          function finish(error: Error | null) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            owned!.child.stdout.removeListener("data", receive);
            owned!.child.removeListener("close", closed);
            requestSignal.removeEventListener("abort", closed);
            if (error) reject(error);
            else resolve();
          }
          function closed() {
            finish(new PreviewError("输入连接中断，未确认的操作不会重放"));
          }
          function receive(chunk: Buffer) {
            bytes += chunk.toString();
            if (bytes.length > 4096) {
              closed();
              return;
            }
            const end = bytes.indexOf("\n");
            if (end < 0) return;
            try {
              const ack = ackSchema.parse(JSON.parse(bytes.slice(0, end)));
              finish(ack.ok ? null : new PreviewError("模拟器未接受输入，请刷新画面后重试"));
            } catch {
              closed();
            }
          }
          const timer = setTimeout(closed, 3000);
          owned.child.stdout.on("data", receive);
          owned.child.once("close", closed);
          requestSignal.addEventListener("abort", closed, { once: true });
          if (requestSignal.aborted) {
            closed();
            return;
          }
          owned.child.stdin.write(`${JSON.stringify(envelope)}\n`, (error) => {
            if (error) closed();
          });
        });
      }
      async function touch(
        action: Extract<InputAction, { type: "touch" }>,
        requestSignal = joinedSignal,
      ) {
        if (action.phase !== "up" && action.geometry !== frames.latest?.geometry)
          throw new PreviewError("画面方向已变化，请松开手指后重试");
        if (platform === "ios") {
          const [a, b] = action.points;
          const envelope: Record<string, unknown> = {
            type: `touch${action.points.length}-${action.phase}`,
            width,
            height,
          };
          if (b)
            Object.assign(envelope, {
              x1: a!.x * width,
              y1: a!.y * height,
              x2: b.x * width,
              y2: b.y * height,
            });
          else Object.assign(envelope, { x: a!.x * width, y: a!.y * height });
          contacts = action.phase === "up" ? null : action;
          await iosInput(envelope, requestSignal);
          return;
        }
        if (!endpoint) throw new PreviewError("输入通道尚未就绪");
        const latest = frames.latest;
        const landscape = latest !== null && latest.width > latest.height;
        const touchWidth = landscape ? Math.max(width, height) : Math.min(width, height),
          touchHeight = landscape ? Math.min(width, height) : Math.max(width, height);
        const touches = action.points.map((point, index) =>
          field(
            1,
            Buffer.concat([
              field(1, Math.round(point.x * (touchWidth - 1))),
              field(2, Math.round(point.y * (touchHeight - 1))),
              field(3, index),
              field(4, action.phase === "up" ? 0 : 1024),
            ]),
          ),
        );
        contacts = action.phase === "up" ? null : action;
        await grpc(endpoint, "sendTouch", Buffer.concat(touches), { signal: requestSignal });
        return;
      }
      async function appearance(dark: boolean) {
        const available = await detected();
        if (platform === "ios" && available.xcrun) {
          await run(available.xcrun, [
            "simctl",
            "ui",
            device.id,
            "appearance",
            dark ? "dark" : "light",
          ]);
          return;
        }
        if (available.android && serial) {
          await run(available.android.adb, [
            "-s",
            serial,
            "shell",
            "cmd",
            "uimode",
            "night",
            dark ? "yes" : "no",
          ]);
          return;
        }
        throw new PreviewError("明暗模式通道不可用");
      }
      async function iosControl(action: InputAction) {
        if (action.type === "home" || action.type === "recents") {
          await iosInput({
            type: "button",
            button: action.type === "home" ? "swipe-to-home" : "swipe-to-app-switcher",
          });
          return;
        }
        if (action.type !== "rotate" || !binary || !inputProcess)
          throw new PreviewError("此设备不支持该操作");
        if (contacts) await touch({ ...contacts, phase: "up" });
        const previous = inputProcess;
        await previous.stop();
        processes.delete(previous);
        const orientation = frames.latest?.rotation === 90 ? "portrait" : "landscape-left";
        await run(binary, ["orientation", "--udid", device.id, orientation]);
        screen = screenSchema.parse(
          JSON.parse((await run(binary, ["describe-ui", "--udid", device.id])).toString()),
        ).screen;
        width = screen.width;
        height = screen.height;
        frames.setRotation(screenRotation(screen.orientation));
        joinedSignal.throwIfAborted();
        inputProcess = launch(binary, [
          "input",
          "--udid",
          device.id,
          "--expected-screen",
          JSON.stringify(screen),
        ]);
        processes.add(inputProcess);
      }
      async function perform(action: InputAction) {
        joinedSignal.throwIfAborted();
        if (streamError) throw streamError;
        if (action.type === "touch") {
          await touch(action);
          return;
        }
        if (action.type === "appearance") {
          await appearance(action.dark);
          return;
        }
        if (platform === "ios") {
          await iosControl(action);
          return;
        }
        if (endpoint && ["back", "home", "recents"].includes(action.type)) {
          const keys = { back: "GoBack", home: "GoHome", recents: "AppSwitch" };
          if (action.type !== "back" && action.type !== "home" && action.type !== "recents")
            throw new PreviewError("无效的设备按键");
          await grpc(
            endpoint,
            "sendKey",
            Buffer.concat([field(2, 2), field(4, Buffer.from(keys[action.type]))]),
            { signal: joinedSignal },
          );
          return;
        }
        throw new PreviewError("此设备不支持该操作");
      }
      return {
        controls,
        async prepare() {
          preparationDeadline = Date.now() + 150_000;
          try {
            if (platform === "ios") await prepareIos();
            else await prepareAndroid();
          } finally {
            preparationDeadline = Infinity;
          }
          const deadline = Date.now() + 15_000;
          while (!frames.latest && Date.now() < deadline) {
            joinedSignal.throwIfAborted();
            if (streamError) throw streamError;
            await delay(50, undefined, { signal: joinedSignal });
          }
          if (!frames.latest) throw new PreviewError("原生采集未返回首帧，请重试");
        },
        input(action) {
          const task = inputTail.then(() => perform(action));
          inputTail = task.catch(() => {});
          return task;
        },
        check() {
          if (streamError) throw streamError;
        },
        async close() {
          controller.abort();
          if (frameTimer) clearTimeout(frameTimer);
          frameTimer = null;
          pendingFrame = null;
          await inputTail;
          let contactError: unknown = null;
          try {
            if (contacts) await touch({ ...contacts, phase: "up" }, AbortSignal.timeout(1500));
          } catch (error) {
            contactError = error;
          }
          // Stop only preview helpers and requests. Never shutdown a simulator or adb.
          const stopped = await Promise.allSettled([...processes].map((owned) => owned.stop()));
          await Promise.allSettled(tasks);
          const failure = stopped.find((item) => item.status === "rejected");
          if (failure?.status === "rejected") throw failure.reason;
          if (contactError) throw contactError;
        },
      };
    },
  };
}
