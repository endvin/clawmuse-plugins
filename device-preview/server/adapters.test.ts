import { createServer, type ServerHttp2Stream } from "node:http2";
import { expect, it } from "vitest";
import { createBackend } from "./adapters.js";
import { field, fields } from "./android-grpc.js";
import { FrameStore } from "./frames.js";

function reply(stream: ServerHttp2Stream, bytes: Buffer) {
  stream.respond({ "content-type": "application/grpc" }, { waitForTrailers: true });
  stream.on("wantTrailers", () => stream.sendTrailers({ "grpc-status": "0" }));
  const head = Buffer.alloc(5);
  head.writeUInt32BE(bytes.length, 1);
  stream.end(Buffer.concat([head, bytes]));
}

it("streams an existing AVD, releases contacts on stop and never generates emulator shutdown commands", async () => {
  const server = createServer();
  const commands: string[][] = [];
  const messages: { method: string; payload: Buffer }[] = [];
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=",
    "base64",
  );
  server.on("stream", (stream, headers) => {
    const method = String(headers[":path"]).split("/").at(-1)!;
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => {
      const bytes = Buffer.concat(chunks);
      messages.push({ method, payload: bytes.subarray(5) });
      if (method === "streamScreenshot") {
        const image = Buffer.concat([field(1, field(3, 1)), field(4, png)]),
          head = Buffer.alloc(5);
        head.writeUInt32BE(image.length, 1);
        stream.respond({ "content-type": "application/grpc" });
        stream.write(Buffer.concat([head, image]));
        return;
      }
      reply(stream, Buffer.alloc(0));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("test emulator did not bind");
  const lifetime = new AbortController();
  const backend = createBackend(lifetime.signal, {
    detect: async () => ({ android: { adb: "adb", emulator: "emulator" }, xcrun: null }),
    endpoint: async () => ({
      port: address.port,
      token: "test-only",
      pid: process.pid,
      serial: "emulator-5554",
    }),
    runCommand: async (tool, args) => {
      commands.push([tool, ...args]);
      if (args[0] === "-list-avds") return Buffer.from("Pixel\n");
      if (args[0] === "devices")
        return Buffer.from("List of devices attached\nemulator-5554\tdevice\n");
      if (args.includes("name")) return Buffer.from("Pixel\nOK\n");
      if (args.includes("getprop")) return Buffer.from("1\n");
      if (args.includes("size")) return Buffer.from("Physical size: 1080x2400\n");
      throw Error("Unexpected SDK command");
    },
  });
  const frames = new FrameStore();
  const list = await backend.list("android", lifetime.signal);
  const session = backend.open("android", list.devices[0]!, "balanced", frames, lifetime.signal);
  try {
    await session.prepare();
    expect(frames.latest).toMatchObject({ width: 1, height: 1, mime: "image/png" });
    await session.input({ type: "home" });
    await session.input({ type: "touch", phase: "down", points: [{ x: 1, y: 1 }], geometry: 1 });
    const beforeStop = commands.slice();
    await session.close();
    expect(commands).toEqual(beforeStop);
    expect(commands.flat()).not.toContain("shutdown");
    expect(commands.flat()).not.toContain("kill-server");
    const key = messages.find((message) => message.method === "sendKey")!;
    expect(fields(key.payload).get(2)).toEqual([2]);
    const touches = messages.filter((message) => message.method === "sendTouch");
    const down = fields(touches[0]!.payload).get(1)![0];
    const up = fields(touches[1]!.payload).get(1)![0];
    if (!Buffer.isBuffer(down) || !Buffer.isBuffer(up)) throw Error("Missing native touch payload");
    expect(fields(down)).toEqual(
      new Map([
        [1, [1079]],
        [2, [2399]],
        [3, [0]],
        [4, [1024]],
      ]),
    );
    expect(fields(up).get(4)).toEqual([0]);
  } finally {
    lifetime.abort();
    await session.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
