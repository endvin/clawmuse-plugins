import { z } from "zod";
import { avdIdSchema, udidSchema, type Device } from "../shared/contracts.js";

export interface ListedDevice extends Omit<Device, "busy"> {
  serial: string | null;
}
export interface AdbDevice {
  serial: string;
  state: string;
}
export interface AndroidInstance extends AdbDevice {
  avd: string | null;
}

export function parseAvds(stdout: string): string[] {
  const names = stdout.split(/\r?\n/).filter((line) => avdIdSchema.safeParse(line).success);
  return [...new Set(names)].slice(0, 500);
}

export function parseAdbDevices(stdout: string): AdbDevice[] {
  const devices: AdbDevice[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^(emulator-\d+)\s+(\S+)/.exec(line);
    if (match) devices.push({ serial: match[1]!, state: match[2]! });
  }
  return devices.slice(0, 500);
}

export function matchAndroidDevices(avds: string[], instances: AndroidInstance[]): ListedDevice[] {
  return avds.map((id) => {
    const matches = instances.filter(
      (instance) => /^emulator-\d+$/.test(instance.serial) && instance.avd === id,
    );
    if (matches.length > 1)
      return {
        id,
        name: id,
        state: "unavailable",
        reason: "同一个 AVD 有多个运行实例，无法选择",
        serial: null,
      };
    const instance = matches[0];
    if (!instance) return { id, name: id, state: "shutdown", reason: null, serial: null };
    if (instance.state !== "device")
      return { id, name: id, state: "unavailable", reason: "模拟器离线或尚未就绪", serial: null };
    return { id, name: id, state: "booted", reason: null, serial: instance.serial };
  });
}

const simctlSchema = z.object({
  devices: z.record(
    z.string(),
    z.array(
      z.object({
        udid: z.string(),
        name: z.string().min(1).max(200),
        state: z.string(),
        isAvailable: z.boolean(),
      }),
    ),
  ),
});

export function parseSimctlDevices(json: unknown): ListedDevice[] {
  const result: ListedDevice[] = [];
  for (const [runtime, devices] of Object.entries(simctlSchema.parse(json).devices)) {
    if (!runtime.includes(".iOS-")) continue;
    for (const device of devices) {
      if (!device.isAvailable || !udidSchema.safeParse(device.udid).success) continue;
      let state: ListedDevice["state"] = "unavailable";
      if (device.state === "Booted") state = "booted";
      if (device.state === "Shutdown") state = "shutdown";
      const reason = state === "unavailable" ? "设备正在切换状态，请稍后刷新" : null;
      result.push({ id: device.udid, name: device.name, state, reason, serial: null });
    }
  }
  return result.slice(0, 500);
}
