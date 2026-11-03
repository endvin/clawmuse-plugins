import { describe, expect, it } from "vitest";
import {
  parseAdbDevices,
  parseAvds,
  matchAndroidDevices,
  parseSimctlDevices,
} from "./discovery.js";

describe("device discovery without an SDK", () => {
  it("accepts only configured safe AVD names", () => {
    expect(parseAvds("Pixel_8\nTablet-35.1\n bad\nbad name\nbad;id\n")).toEqual([
      "Pixel_8",
      "Tablet-35.1",
    ]);
  });

  it("excludes physical devices, offline emulators and duplicate AVD instances", () => {
    const serials = parseAdbDevices(
      "List of devices attached\nemulator-5554\tdevice product:sdk\nemulator-5556\tdevice\nR58ABC\tdevice\nemulator-5558\toffline\nlocalhost:5555\tdevice\n",
    );
    expect(serials).toEqual([
      { serial: "emulator-5554", state: "device" },
      { serial: "emulator-5556", state: "device" },
      { serial: "emulator-5558", state: "offline" },
    ]);
    const result = matchAndroidDevices(
      ["Pixel_8", "Tablet"],
      [
        { serial: "emulator-5554", state: "device", avd: "Pixel_8" },
        { serial: "emulator-5556", state: "device", avd: "Pixel_8" },
        { serial: "R58ABC", state: "device", avd: "Tablet" },
      ],
    );
    expect(result).toEqual([
      {
        id: "Pixel_8",
        name: "Pixel_8",
        state: "unavailable",
        reason: "同一个 AVD 有多个运行实例，无法选择",
        serial: null,
      },
      { id: "Tablet", name: "Tablet", state: "shutdown", reason: null, serial: null },
    ]);
  });

  it("only lists available simctl devices with valid UDIDs", () => {
    const udid = "12345678-1234-1234-1234-123456789ABC";
    expect(
      parseSimctlDevices({
        devices: {
          "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [
            { name: "iPhone", udid, state: "Booted", isAvailable: true },
            {
              name: "Old",
              udid: "87654321-1234-1234-1234-123456789ABC",
              state: "Shutdown",
              isAvailable: false,
            },
            { name: "Invalid", udid: "x;id", state: "Shutdown", isAvailable: true },
          ],
        },
      }),
    ).toEqual([{ id: udid, name: "iPhone", state: "booted", reason: null, serial: null }]);
  });
});
