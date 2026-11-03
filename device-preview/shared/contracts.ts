import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// 320 KiB stays below 512 KiB even after base64 and RPC envelopes.
// Transport limits: protocol/websocket-message-limit (100 MiB; relay 32 MiB).
export const MAX_FRAME_BYTES = 320 * 1024;
export const MAX_FRAME_BASE64 = Math.ceil(MAX_FRAME_BYTES / 3) * 4;
export const LEASE_MS = 30_000;
export const qualitySchema = z.enum(["saving", "balanced", "clear"]);
export type Quality = z.infer<typeof qualitySchema>;
export const qualityPresets = {
  saving: { edge: 640, fps: 10, scale: 4, jpeg: 0.5 },
  balanced: { edge: 960, fps: 20, scale: 3, jpeg: 0.65 },
  clear: { edge: 1280, fps: 30, scale: 2, jpeg: 0.8 },
} as const;
export const platformSchema = z.enum(["android", "ios"]);
export type Platform = z.infer<typeof platformSchema>;
export const avdIdSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,200}$/);
export const udidSchema = z
  .string()
  .regex(/^[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$/);
export const deviceSchema = z.strictObject({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  state: z.enum(["booted", "shutdown", "unavailable"]),
  reason: z.string().max(200).nullable(),
  busy: z.boolean(),
});
export type Device = z.infer<typeof deviceSchema>;
const capabilitySchema = z.strictObject({ available: z.boolean(), reason: z.string().max(200) });
export const capabilitiesRpc = defineRpc({
  name: "device-preview.capabilities",
  input: z.strictObject({}),
  output: z.strictObject({ android: capabilitySchema, ios: capabilitySchema }),
});
export const listRpc = defineRpc({
  name: "device-preview.list",
  input: z.strictObject({ platform: platformSchema }),
  output: z.strictObject({
    devices: z.array(deviceSchema).max(500),
    notes: z.array(z.string().max(200)).max(10),
  }),
});
const operationIdSchema = z.uuid();
export const operationSchema = z.strictObject({
  operationId: operationIdSchema,
  platform: platformSchema,
  deviceId: z.string().max(200),
  quality: qualitySchema,
  controls: z.array(z.enum(["touch", "back", "home", "recents", "appearance", "rotate"])),
  phase: z.enum(["preparing", "ready", "failed", "stopped"]),
  reason: z.string().max(200).nullable(),
});
export type OperationStatus = z.infer<typeof operationSchema>;
export const startRpc = defineRpc({
  name: "device-preview.start",
  input: z.discriminatedUnion("platform", [
    z.strictObject({
      platform: z.literal("android"),
      deviceId: avdIdSchema,
      quality: qualitySchema,
    }),
    z.strictObject({ platform: z.literal("ios"), deviceId: udidSchema, quality: qualitySchema }),
  ]),
  output: operationSchema,
});
const operationInput = z.strictObject({ operationId: operationIdSchema });
export const statusRpc = defineRpc({
  name: "device-preview.status",
  input: operationInput,
  output: operationSchema,
});
export const imageSchema = z.strictObject({
  base64: z.string().max(MAX_FRAME_BASE64),
  mime: z.enum(["image/jpeg", "image/png"]),
  width: z.number().int().positive().max(4096),
  height: z.number().int().positive().max(4096),
  sequence: z.number().int().positive(),
  geometry: z.number().int().nonnegative(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
});
export type PreviewImage = z.infer<typeof imageSchema>;
export const frameRpc = defineRpc({
  name: "device-preview.frame",
  input: operationInput.extend({ afterSequence: z.number().int().nonnegative().optional() }),
  output: z.strictObject({
    status: operationSchema,
    image: imageSchema.nullable(),
    unchanged: z.boolean(),
  }),
});
const point = z.number().finite().min(0).max(1);
export const touchPointSchema = z.strictObject({ x: point, y: point });
export const actionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.enum(["back", "home", "recents"]) }),
  z.strictObject({ type: z.literal("appearance"), dark: z.boolean() }),
  z.strictObject({ type: z.literal("rotate") }),
  z.strictObject({
    type: z.literal("touch"),
    phase: z.enum(["down", "move", "up"]),
    points: z.array(touchPointSchema).min(1).max(2),
    geometry: z.number().int().nonnegative(),
  }),
]);
export type InputAction = z.infer<typeof actionSchema>;
export const inputRpc = defineRpc({
  name: "device-preview.input",
  input: operationInput.extend({ action: actionSchema }),
  output: z.strictObject({ ok: z.literal(true) }),
});
export const stopRpc = defineRpc({
  name: "device-preview.stop",
  input: operationInput,
  output: operationSchema,
});
