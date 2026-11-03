// Adapted from Cindy official plugins, cindy-simulator/node/android/grpc.cjs,
// commit 4223c43e440d2c695b6ad649b9a4d97b22a7cf4c (Apache-2.0).
// Changes: typed, dependency-free protobuf subset, smaller limits and joined cancellation.
import { connect } from "node:http2";
import { PreviewError } from "./errors.js";

export interface EmulatorEndpoint {
  port: number;
  token: string;
  pid: number;
  serial: string;
}
export type GrpcMethod = "getScreenshot" | "streamScreenshot" | "sendTouch" | "sendKey";
const MAX_GRPC_BYTES = 2 * 1024 * 1024;

export function varint(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) throw new PreviewError("无效的模拟器输入");
  const bytes: number[] = [];
  do {
    const remainder = value % 128;
    value = Math.floor(value / 128);
    bytes.push(remainder | (value > 0 ? 128 : 0));
  } while (value > 0);
  return Buffer.from(bytes);
}
export function field(id: number, value: number | Buffer): Buffer {
  if (typeof value === "number") return Buffer.concat([varint(id * 8), varint(value)]);
  return Buffer.concat([varint(id * 8 + 2), varint(value.length), value]);
}
export function fields(bytes: Buffer): Map<number, (number | Buffer)[]> {
  const result = new Map<number, (number | Buffer)[]>();
  let offset = 0;
  function read(): number {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (offset >= bytes.length) throw new PreviewError("模拟器返回不完整的消息");
      const byte = bytes[offset++]!;
      value |= BigInt(byte & 127) << shift;
      if (!(byte & 128)) return Number(value);
    }
    throw new PreviewError("模拟器返回无效的消息");
  }
  while (offset < bytes.length) {
    const key = read(),
      id = Math.floor(key / 8),
      wire = key % 8;
    if (id === 0) throw new PreviewError("模拟器返回无效的字段");
    let value: number | Buffer;
    if (wire === 0) value = read();
    else if (wire === 2) {
      const size = read();
      if (size > MAX_GRPC_BYTES || offset + size > bytes.length)
        throw new PreviewError("模拟器消息超出上限");
      value = bytes.subarray(offset, offset + size);
      offset += size;
    } else if (wire === 1 || wire === 5) {
      offset += wire === 1 ? 8 : 4;
      if (offset > bytes.length) throw new PreviewError("模拟器消息不完整");
      continue;
    } else throw new PreviewError("模拟器消息格式不受支持");
    const previous = result.get(id) ?? [];
    previous.push(value);
    result.set(id, previous);
  }
  return result;
}
export function imageBytes(message: Buffer): Buffer | null {
  const bytes = fields(message).get(4)?.[0];
  if (bytes === undefined) return null;
  if (!Buffer.isBuffer(bytes)) throw new PreviewError("模拟器返回无效画面");
  if (!bytes.length) return null;
  return bytes;
}
export interface GrpcOptions {
  signal: AbortSignal;
  onData?: (bytes: Buffer) => void;
}
export async function grpc(
  endpoint: EmulatorEndpoint,
  method: GrpcMethod,
  payload: Buffer,
  options: GrpcOptions,
): Promise<Buffer> {
  options.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let done = false,
      buffer: Buffer = Buffer.alloc(0),
      last: Buffer = Buffer.alloc(0),
      status: number | null = null;
    const client = connect(`http://127.0.0.1:${endpoint.port}`);
    const stream = client.request({
      ":method": "POST",
      ":path": `/android.emulation.control.EmulatorController/${method}`,
      "content-type": "application/grpc",
      te: "trailers",
      authorization: `Bearer ${endpoint.token}`,
    });
    const fail = () =>
      finish(new PreviewError("模拟器连接中断，请刷新设备后重新连接；操作不会自动重放"));
    const timer = options.onData ? null : setTimeout(fail, 5000);
    function finish(error: Error | null) {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      options.signal.removeEventListener("abort", fail);
      // destroy() closes the HTTP/2 session and all its streams synchronously.
      stream.close();
      client.destroy();
      if (error) reject(error);
      else resolve(last);
    }
    options.signal.addEventListener("abort", fail, { once: true });
    client.on("error", fail);
    stream.on("error", fail);
    stream.on("response", (headers) => {
      if (headers["grpc-status"] !== undefined) status = Number(headers["grpc-status"]);
      if (headers[":status"] !== 200) fail();
    });
    stream.on("trailers", (headers) => {
      status = Number(headers["grpc-status"]);
    });
    stream.on("data", (chunk: Buffer) => {
      if (done) return;
      if (buffer.length + chunk.length > MAX_GRPC_BYTES + 5) {
        fail();
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      try {
        while (buffer.length >= 5) {
          const size = buffer.readUInt32BE(1);
          if (buffer[0] !== 0 || size > MAX_GRPC_BYTES) throw new PreviewError("画面消息超出上限");
          if (buffer.length < size + 5) break;
          last = buffer.subarray(5, size + 5);
          buffer = buffer.subarray(size + 5);
          options.onData?.(last);
        }
      } catch (error) {
        if (error instanceof PreviewError) finish(error);
        else fail();
      }
    });
    stream.on("end", () =>
      finish(
        status === 0 && buffer.length === 0
          ? null
          : new PreviewError("模拟器画面流已结束，请重新连接"),
      ),
    );
    const header = Buffer.alloc(5);
    header.writeUInt32BE(payload.length, 1);
    stream.end(Buffer.concat([header, payload]));
  });
}
