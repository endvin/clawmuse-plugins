import { createHash } from "node:crypto";
import { MAX_FRAME_BYTES, type PreviewImage } from "../shared/contracts.js";
import { PreviewError } from "./errors.js";

export function imageSize(
  bytes: Buffer,
  mime: PreviewImage["mime"],
): { width: number; height: number } {
  if (mime === "image/png") {
    if (
      bytes.length < 24 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw new PreviewError("无效的 PNG 画面");
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 255) throw new PreviewError("无效的 JPEG 画面");
    const marker = bytes[offset + 1]!;
    const size = bytes.readUInt16BE(offset + 2);
    if (size < 2) break;
    if ([192, 193, 194].includes(marker))
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    offset += size + 2;
  }
  throw new PreviewError("无法识别画面尺寸");
}

export class JpegParser {
  private bytes: Buffer = Buffer.alloc(0);
  constructor(private readonly receive: (bytes: Buffer) => void) {}
  push(chunk: Buffer) {
    if (this.bytes.length + chunk.length > MAX_FRAME_BYTES * 2)
      throw new PreviewError("画面超过大小上限，请降低画质");
    this.bytes = Buffer.concat([this.bytes, chunk]);
    let end = this.bytes.indexOf(Buffer.from([255, 217]));
    while (end !== -1) {
      const start = this.bytes.indexOf(Buffer.from([255, 216]));
      if (start < 0 || start > end || end + 2 - start > MAX_FRAME_BYTES)
        throw new PreviewError("画面超过大小上限或格式无效");
      this.receive(Buffer.from(this.bytes.subarray(start, end + 2)));
      this.bytes = this.bytes.subarray(end + 2);
      end = this.bytes.indexOf(Buffer.from([255, 217]));
    }
    if (this.bytes.length > MAX_FRAME_BYTES) throw new PreviewError("画面超过大小上限，请降低画质");
  }
}

export class FrameStore {
  latest: PreviewImage | null = null;
  private hash = "";
  private rotation: PreviewImage["rotation"] = 0;
  private listeners = new Set<() => void>();
  push(bytes: Buffer, mime: PreviewImage["mime"]) {
    if (bytes.length > MAX_FRAME_BYTES) throw new PreviewError("画面超过大小上限，请降低画质");
    const size = imageSize(bytes, mime);
    if (size.width < 1 || size.height < 1 || size.width > 4096 || size.height > 4096)
      throw new PreviewError("画面尺寸无效");
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash === this.hash) return;
    this.hash = hash;
    const previous = this.latest;
    const changed = !previous || previous.width !== size.width || previous.height !== size.height;
    const geometry = (previous?.geometry ?? 0) + Number(changed);
    this.latest = {
      ...size,
      mime,
      rotation: this.rotation,
      base64: bytes.toString("base64"),
      sequence: (previous?.sequence ?? 0) + 1,
      geometry,
    };
    for (const listener of this.listeners) listener();
  }
  setRotation(rotation: PreviewImage["rotation"]) {
    if (this.rotation === rotation) return;
    this.rotation = rotation;
    if (this.latest)
      this.latest = {
        ...this.latest,
        rotation,
        geometry: this.latest.geometry + 1,
        sequence: this.latest.sequence + 1,
      };
    for (const listener of this.listeners) listener();
  }
  async wait(afterSequence: number, signal: AbortSignal) {
    if (signal.aborted || (this.latest && this.latest.sequence > afterSequence)) return;
    let resolveWait = () => {};
    const waiting = new Promise<void>((resolve) => {
      resolveWait = resolve;
    });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      this.listeners.delete(finish);
      signal.removeEventListener("abort", finish);
      resolveWait();
    };
    const timer = setTimeout(finish, 750);
    this.listeners.add(finish);
    signal.addEventListener("abort", finish, { once: true });
    await waiting;
  }
  clear() {
    this.latest = null;
    for (const listener of this.listeners) listener();
    this.listeners.clear();
  }
}
