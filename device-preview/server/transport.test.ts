import { createServer, type ServerHttp2Stream } from "node:http2";
import { afterEach, describe, expect, it } from "vitest";
import { field, grpc, imageBytes, type EmulatorEndpoint } from "./android-grpc.js";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});
async function emulator(): Promise<{
  server: ReturnType<typeof createServer>;
  endpoint: EmulatorEndpoint;
}> {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("test server did not bind");
  return {
    server,
    endpoint: { port: address.port, token: "test-only", pid: process.pid, serial: "emulator-5554" },
  };
}
function record(bytes: Buffer) {
  const header = Buffer.alloc(5);
  header.writeUInt32BE(bytes.length, 1);
  return Buffer.concat([header, bytes]);
}
function respond(stream: ServerHttp2Stream) {
  stream.respond({ "content-type": "application/grpc" }, { waitForTrailers: true });
  stream.on("wantTrailers", () => stream.sendTrailers({ "grpc-status": "0" }));
}
describe("real HTTP/2 emulator transport without an SDK", () => {
  it("decodes split gRPC records and observes clean trailers", async () => {
    const { server, endpoint } = await emulator();
    const image = Buffer.from("bounded-frame");
    server.on("stream", (stream) => {
      respond(stream);
      const bytes = record(field(4, image));
      stream.write(bytes.subarray(0, 3));
      stream.end(bytes.subarray(3));
    });
    expect(
      imageBytes(
        await grpc(endpoint, "getScreenshot", Buffer.alloc(0), {
          signal: AbortSignal.timeout(3000),
        }),
      ),
    ).toEqual(image);
  });
  it("closes an active stream on cancellation and rejects oversized records", async () => {
    const { server, endpoint } = await emulator();
    let received = () => {};
    const first = new Promise<void>((resolve) => {
      received = resolve;
    });
    server.on("stream", (stream) => {
      stream.respond({ "content-type": "application/grpc" });
      stream.write(record(field(4, Buffer.from("frame"))));
    });
    const abort = new AbortController();
    const running = grpc(endpoint, "streamScreenshot", Buffer.alloc(0), {
      signal: abort.signal,
      onData: () => received(),
    });
    const rejected = expect(running).rejects.toThrow("连接中断");
    await first;
    abort.abort();
    await rejected;
  });
  it("refuses malicious frame lengths before buffering their body", async () => {
    const { server, endpoint } = await emulator();
    server.on("stream", (stream) => {
      stream.respond({ "content-type": "application/grpc" });
      const head = Buffer.alloc(5);
      head.writeUInt32BE(0xffffffff, 1);
      stream.end(head);
    });
    await expect(
      grpc(endpoint, "getScreenshot", Buffer.alloc(0), { signal: AbortSignal.timeout(3000) }),
    ).rejects.toThrow("画面消息超出上限");
  });
});
