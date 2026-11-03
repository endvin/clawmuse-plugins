import { access, constants, readdir, readFile, stat } from "node:fs/promises";
import { homedir, tmpdir, release } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { command } from "./process.js";
import type { EmulatorEndpoint } from "./android-grpc.js";
import { PreviewError } from "./errors.js";

export interface AndroidTools {
  adb: string;
  emulator: string;
}
export interface Tools {
  android: AndroidTools | null;
  xcrun: string | null;
}
async function executable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
export async function discoverTools(signal: AbortSignal): Promise<Tools> {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const roots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(homedir(), "Library", "Android", "sdk"),
    join(homedir(), "Android", "Sdk"),
    join(process.env.LOCALAPPDATA ?? homedir(), "Android", "Sdk"),
  ];
  let android: AndroidTools | null = null;
  for (const root of roots) {
    if (!root) continue;
    const adb = join(root, "platform-tools", `adb${suffix}`),
      emulator = join(root, "emulator", `emulator${suffix}`);
    if ((await executable(adb)) && (await executable(emulator))) {
      android = { adb, emulator };
      break;
    }
  }
  let xcrun: string | null = null;
  if (
    process.platform === "darwin" &&
    Number(release().split(".")[0]) >= 24 &&
    process.arch === "arm64" &&
    (await executable("/usr/bin/xcrun"))
  ) {
    try {
      await command("/usr/bin/xcrun", ["simctl", "help"], { signal });
      xcrun = "/usr/bin/xcrun";
    } catch {
      /* Capability stays unavailable. */
    }
  }
  return { android, xcrun };
}
const endpointSchema = z.strictObject({
  port: z.coerce.number().int().min(1024).max(65535),
  token: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[\x21-\x7E]+$/),
  pid: z.number().int().positive(),
  serial: z.string().regex(/^emulator-\d+$/),
});

// Discovery records are written by the SDK, never supplied by an RPC caller.
export async function androidEndpoint(
  avd: string,
  serial: string,
): Promise<EmulatorEndpoint | null> {
  const roots = [
    join(homedir(), "Library/Caches/TemporaryItems/avd/running"),
    join(process.env.XDG_RUNTIME_DIR ?? join(homedir(), ".cache"), "avd/running"),
    join(process.env.LOCALAPPDATA ?? tmpdir(), "Temp/avd/running"),
    join(tmpdir(), "avd/running"),
  ];
  const found = new Map<number, EmulatorEndpoint>();
  for (const root of new Set(roots)) {
    let names: string[];
    try {
      names = await readdir(root);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw new PreviewError("无法读取模拟器连接状态");
    }
    for (const name of names.slice(0, 500)) {
      const match = /^pid_(\d+)(?:_info)?\.ini$/.exec(name);
      if (!match) continue;
      const file = join(root, name);
      let raw: string;
      try {
        if ((await stat(file)).size > 16384) continue;
        raw = await readFile(file, "utf8");
      } catch {
        continue;
      }
      const values = new Map<string, string>();
      for (const line of raw.split(/\r?\n/)) {
        const entry = /^\s*([^#;=]+?)\s*=\s*(.*?)\s*$/.exec(line);
        if (entry) values.set(entry[1]!, entry[2]!);
      }
      if (values.get("avd.id") !== avd || `emulator-${values.get("port.serial")}` !== serial)
        continue;
      const parsed = endpointSchema.safeParse({
        port: values.get("grpc.port"),
        token: values.get("grpc.token"),
        pid: Number(match[1]),
        serial,
      });
      if (!parsed.success) continue;
      try {
        process.kill(parsed.data.pid, 0);
      } catch {
        continue;
      }
      found.set(parsed.data.pid, parsed.data);
    }
  }
  if (found.size > 1) throw new PreviewError("设备连接记录不唯一，请检查模拟器实例");
  return found.values().next().value ?? null;
}
