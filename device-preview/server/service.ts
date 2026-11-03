import { randomUUID } from "node:crypto";
import {
  LEASE_MS,
  startRpc,
  type Platform,
  type OperationStatus,
  type InputAction,
} from "../shared/contracts.js";
import type { RpcInput } from "@getpaseo/plugin";
import { FrameStore } from "./frames.js";
import { publicError, PreviewError } from "./errors.js";
import {
  createBackend,
  type DeviceList,
  type PreviewBackend,
  type PreviewSession,
} from "./adapters.js";

interface Operation {
  status: OperationStatus;
  key: string;
  signal: AbortController;
  session: PreviewSession;
  frames: FrameStore;
  lastPoll: number;
  preparing: Promise<void>;
  releasing: Promise<void> | null;
  inputs: number;
}
interface RecentList {
  at: number;
  list: DeviceList;
}

export function createPreviewService(providedBackend?: PreviewBackend) {
  const lifetime = new AbortController();
  const backend = providedBackend ?? createBackend(lifetime.signal);
  const leases = new Map<string, Operation>();
  const operations = new Map<string, Operation>();
  const recent = new Map<Platform, RecentList>();
  const pendingDiscovery = new Set<Promise<unknown>>();
  async function discovery<T>(task: Promise<T>): Promise<T> {
    pendingDiscovery.add(task);
    try {
      return await task;
    } finally {
      pendingDiscovery.delete(task);
    }
  }
  const timer = setInterval(() => {
    const now = Date.now();
    for (const op of operations.values()) {
      if (now - op.lastPoll < LEASE_MS) continue;
      if (leases.get(op.key) === op) void stop(op.status.operationId).catch(() => {});
      else operations.delete(op.status.operationId);
    }
  }, 1000);
  timer.unref();

  function operation(id: string): Operation {
    const op = operations.get(id);
    if (!op) throw new PreviewError("预览操作不存在或已过期，请重新选择设备");
    return op;
  }
  function status(id: string): OperationStatus {
    return { ...operation(id).status };
  }
  function release(op: Operation): Promise<void> {
    op.releasing ??= op.session
      .close()
      .then(async () => {
        await op.preparing;
        op.frames.clear();
        if (leases.get(op.key) === op) leases.delete(op.key);
        return;
      })
      .catch((error) => {
        op.status.reason = publicError(error);
        throw error;
      });
    return op.releasing;
  }
  async function stop(id: string): Promise<OperationStatus> {
    const op = operation(id);
    op.status.phase = "stopped";
    op.signal.abort();
    await release(op);
    await op.preparing;
    return status(id);
  }
  return {
    async capabilities() {
      try {
        return await discovery(backend.capabilities());
      } catch (error) {
        throw new PreviewError(publicError(error));
      }
    },
    async list(platform: Platform) {
      let list: DeviceList;
      try {
        list = await discovery(backend.list(platform, lifetime.signal));
      } catch (error) {
        throw new PreviewError(publicError(error));
      }
      recent.set(platform, { at: Date.now(), list });
      const devices = list.devices.map(({ serial: _serial, ...device }) => ({
        ...device,
        busy: leases.has(`${platform}:${device.id}`),
      }));
      return { devices, notes: list.notes };
    },
    async start(input: RpcInput<typeof startRpc>): Promise<OperationStatus> {
      const request = startRpc.input.parse(input);
      if (lifetime.signal.aborted) throw new PreviewError("插件正在停止");
      const last = recent.get(request.platform);
      if (!last || Date.now() - last.at > LEASE_MS)
        throw new PreviewError("请先刷新设备列表再连接");
      const device = last.list.devices.find((item) => item.id === request.deviceId);
      if (!device) throw new PreviewError("设备不在最近列表中，请刷新后选择");
      if (device.state === "unavailable") throw new PreviewError(device.reason ?? "设备不可用");
      const key = `${request.platform}:${device.id}`;
      if (leases.has(key)) throw new PreviewError("该设备已被其他预览面板占用，不能抢占");
      if (leases.size >= 8) throw new PreviewError("主机预览数量已达上限，请先停止一个预览");
      if (operations.size >= 128) throw new PreviewError("预览切换过于频繁，请稍后重试");
      const signal = new AbortController(),
        frames = new FrameStore();
      const session = backend.open(
        request.platform,
        device,
        request.quality,
        frames,
        signal.signal,
      );
      const op: Operation = {
        key,
        signal,
        session,
        frames,
        lastPoll: Date.now(),
        inputs: 0,
        releasing: null,
        preparing: Promise.resolve(),
        status: {
          operationId: randomUUID(),
          platform: request.platform,
          deviceId: device.id,
          quality: request.quality,
          controls: session.controls,
          phase: "preparing",
          reason: null,
        },
      };
      leases.set(key, op);
      operations.set(op.status.operationId, op);
      op.preparing = Promise.resolve()
        .then(() => session.prepare())
        .then(() => {
          if (!signal.signal.aborted) op.status.phase = "ready";
          return;
        })
        .catch(async (error) => {
          if (signal.signal.aborted) return;
          op.status.phase = "failed";
          op.status.reason = publicError(error);
          signal.abort();
          void release(op).catch(() => {});
        });
      return status(op.status.operationId);
    },
    status,
    async frame(id: string, afterSequence = 0) {
      const op = operation(id);
      op.lastPoll = Date.now();
      if (op.status.phase === "ready") {
        try {
          op.session.check();
          await op.frames.wait(afterSequence, op.signal.signal);
          op.session.check();
        } catch (error) {
          op.status.phase = "failed";
          op.status.reason = publicError(error);
          op.signal.abort();
          await release(op).catch(() => {});
        }
      }
      const image = op.frames.latest;
      const unchanged = image === null || image.sequence <= afterSequence;
      return { status: status(id), image: unchanged ? null : image, unchanged };
    },
    async input(id: string, action: InputAction): Promise<{ ok: true }> {
      const op = operation(id);
      if (op.status.phase !== "ready") throw new PreviewError("设备尚未连接或预览已停止");
      if (op.inputs >= 8) throw new PreviewError("操作正在处理中，请松开手指后重试");
      op.inputs++;
      try {
        op.session.check();
        await op.session.input(action);
        return { ok: true };
      } catch (error) {
        if (action.type === "touch") {
          op.status.phase = "failed";
          op.status.reason = publicError(error);
          op.signal.abort();
          await release(op).catch(() => {});
        }
        throw new PreviewError(publicError(error));
      } finally {
        op.inputs--;
      }
    },
    stop,
    async close() {
      clearInterval(timer);
      lifetime.abort();
      const stopped = await Promise.allSettled(
        [...leases.values()].map((op) => stop(op.status.operationId)),
      );
      await Promise.allSettled(pendingDiscovery);
      operations.clear();
      recent.clear();
      const failure = stopped.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    },
  };
}
