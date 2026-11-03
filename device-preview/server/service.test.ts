import { afterEach, describe, expect, it, vi } from "vitest";
import { createPreviewService } from "./service.js";
import type { PreviewBackend, PreviewSession } from "./adapters.js";
import type { InputAction } from "../shared/contracts.js";

function backend() {
  let finish: (() => void) | null = null;
  const actions: InputAction[] = [];
  const close = vi.fn(async () => {});
  const session: PreviewSession = {
    controls: ["touch", "home"],
    prepare: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    input: async (action) => {
      actions.push(action);
    },
    close,
    check() {},
  };
  const adapter: PreviewBackend = {
    capabilities: async () => ({
      android: { available: true, reason: "ready" },
      ios: { available: false, reason: "unavailable" },
    }),
    list: async () => ({
      devices: [{ id: "Pixel", name: "Pixel", state: "shutdown", reason: null, serial: null }],
      notes: [],
    }),
    open: () => session,
  };
  return {
    adapter,
    close,
    actions,
    finish: () => {
      if (!finish) throw Error("not started");
      finish();
    },
  };
}
afterEach(() => vi.useRealTimers());
describe("preview leases and cancellation", () => {
  it("only acquires a recently listed device and never steals another panel's lease", async () => {
    const fake = backend(),
      service = createPreviewService(fake.adapter);
    await expect(
      service.start({ platform: "android", deviceId: "Pixel", quality: "balanced" }),
    ).rejects.toThrow("刷新");
    await service.list("android");
    const first = await service.start({
      platform: "android",
      deviceId: "Pixel",
      quality: "balanced",
    });
    expect(first.phase).toBe("preparing");
    await expect(
      service.start({ platform: "android", deviceId: "Pixel", quality: "balanced" }),
    ).rejects.toThrow("占用");
    expect((await service.list("android")).devices[0]?.busy).toBe(true);
    const stop = service.stop(first.operationId);
    fake.finish();
    expect((await stop).phase).toBe("stopped");
    expect(service.status(first.operationId).phase).toBe("stopped");
    expect((await service.list("android")).devices[0]?.busy).toBe(false);
    await service.close();
  });
  it("releases after 30 seconds without frame polling; status does not extend the lease", async () => {
    vi.useFakeTimers();
    const fake = backend(),
      service = createPreviewService(fake.adapter);
    await service.list("android");
    const first = await service.start({
      platform: "android",
      deviceId: "Pixel",
      quality: "balanced",
    });
    fake.finish();
    await vi.advanceTimersByTimeAsync(29_000);
    expect(service.status(first.operationId).phase).toBe("ready");
    await vi.advanceTimersByTimeAsync(1_001);
    expect(service.status(first.operationId).phase).toBe("stopped");
    expect(fake.close).toHaveBeenCalledTimes(1);
    await service.close();
  });
  it("rejects unknown IDs and malicious device IDs", async () => {
    const fake = backend(),
      service = createPreviewService(fake.adapter);
    await service.list("android");
    for (const id of ["Pixel;id", "Pixel name", "Pixel\n", "Pixel'", "Pixel|id", "R58ABC"]) {
      await expect(
        service.start({ platform: "android", deviceId: id, quality: "balanced" }),
      ).rejects.toThrow();
    }
    await expect(service.frame("00000000-0000-4000-8000-000000000000", 0)).rejects.toThrow(
      "不存在",
    );
    await expect(
      service.input("00000000-0000-4000-8000-000000000000", { type: "home" }),
    ).rejects.toThrow("不存在");
    await service.close();
  });
});
