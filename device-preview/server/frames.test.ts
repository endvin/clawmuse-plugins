import { describe, expect, it } from "vitest";
import { FrameStore, JpegParser, imageSize } from "./frames.js";
import { MAX_FRAME_BYTES } from "../shared/contracts.js";

// SOF0 + EOI is enough to verify transport framing, not a decoder fixture.
const jpeg = Buffer.from([255, 216, 255, 192, 0, 11, 8, 0, 20, 0, 10, 1, 1, 17, 0, 255, 217]);
describe("bounded continuous frames", () => {
  it("parses split MJPEG and rejects oversized frames", () => {
    const frames: Buffer[] = [];
    const parser = new JpegParser((frame) => frames.push(frame));
    parser.push(jpeg.subarray(0, 8));
    parser.push(Buffer.concat([jpeg.subarray(8), jpeg]));
    expect(frames).toEqual([jpeg, jpeg]);
    expect(() => parser.push(Buffer.alloc(MAX_FRAME_BYTES + 1))).toThrow();
    expect(imageSize(jpeg, "image/jpeg")).toEqual({ width: 10, height: 20 });
  });
  it("keeps only the latest frame, deduplicates stills and fences geometry changes", () => {
    const frames = new FrameStore();
    frames.push(jpeg, "image/jpeg");
    frames.push(jpeg, "image/jpeg");
    expect(frames.latest?.sequence).toBe(1);
    const changed = Buffer.from(jpeg);
    changed[10] = 11;
    frames.push(changed, "image/jpeg");
    expect(frames.latest).toMatchObject({ sequence: 2, geometry: 2, width: 11, height: 20 });
    expect(() => frames.push(Buffer.alloc(MAX_FRAME_BYTES + 1), "image/png")).toThrow();
  });
});
