import { describe, expect, it } from "vitest";
import { field, fields, imageBytes, varint } from "./android-grpc.js";
describe("Android emulator protobuf subset", () => {
  it("encodes the fixed native screenshot and touch messages", () => {
    const message = Buffer.concat([field(1, 0), field(3, 960), field(4, 960)]);
    expect(fields(message)).toEqual(
      new Map([
        [1, [0]],
        [3, [960]],
        [4, [960]],
      ]),
    );
    const image = Buffer.from([137, 80, 78, 71]);
    expect(imageBytes(field(4, image))).toEqual(image);
  });
  it("rejects truncated messages and invalid input", () => {
    expect(() => fields(Buffer.from([34, 100, 1]))).toThrow();
    expect(() => fields(Buffer.from([128]))).toThrow();
    expect(() => varint(-1)).toThrow();
  });
});
