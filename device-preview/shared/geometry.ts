// Coordinate mapping follows Cindy's cindy-simulator/node/geometry.cjs
// (Apache-2.0, commit 4223c43e440d2c695b6ad649b9a4d97b22a7cf4c).
import type { PreviewImage } from "./contracts.js";
export function nativePoint(x: number, y: number, rotation: PreviewImage["rotation"]) {
  switch (rotation) {
    case 90:
      return { x: y, y: 1 - x };
    case 180:
      return { x: 1 - x, y: 1 - y };
    case 270:
      return { x: 1 - y, y: x };
    default:
      return { x, y };
  }
}
export function screenRotation(
  orientation: "portrait" | "landscape-left" | "portrait-upside-down" | "landscape-right",
): PreviewImage["rotation"] {
  switch (orientation) {
    case "landscape-left":
      return 90;
    case "portrait-upside-down":
      return 180;
    case "landscape-right":
      return 270;
    default:
      return 0;
  }
}
