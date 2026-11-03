import { describe, expect, it } from "vitest";
import { inputRpc, startRpc, frameRpc, MAX_FRAME_BASE64, MAX_FRAME_BYTES } from "./contracts.js";
import { nativePoint } from "./geometry.js";
describe("preview RPC boundary", () => {
  it("rejects extra fields and unbounded coordinates", () => {
    const operationId = "12345678-1234-4123-8123-123456789abc";
    for (const action of [
      { type: "touch", phase: "down", points: [{ x: 1.1, y: 0 }], geometry: 1 },
      { type: "shell", command: "id" },
      { type: "appearance", dark: true, command: "id" },
    ])
      expect(inputRpc.input.safeParse({ operationId, action }).success).toBe(false);
    expect(
      startRpc.input.safeParse({ platform: "ios", deviceId: "booted", quality: "balanced" })
        .success,
    ).toBe(false);
    expect(frameRpc.input.safeParse({ operationId, deviceId: "other" }).success).toBe(false);
    expect(MAX_FRAME_BASE64).toBeLessThan(512 * 1024);
    expect(MAX_FRAME_BYTES).toBeLessThan(512 * 1024);
  });
  it("maps landscape touch points into the exact native framebuffer axes", () => {
    expect(nativePoint(0.25, 0.75, 90)).toEqual({ x: 0.75, y: 0.75 });
    expect(nativePoint(0.25, 0.75, 180)).toEqual({ x: 0.75, y: 0.25 });
    expect(nativePoint(0.25, 0.75, 270)).toEqual({ x: 0.25, y: 0.25 });
  });
});
