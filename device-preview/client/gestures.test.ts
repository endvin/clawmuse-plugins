import { describe, expect, it } from "vitest";
import { GestureTracker, InputQueue } from "./gestures.js";
import type { InputAction } from "../shared/contracts.js";
describe("native preview gestures", () => {
  it("releases the single finger before a pair and waits for all fingers to lift", () => {
    const tracker = new GestureTracker(),
      a = { x: 0.2, y: 0.3 },
      b = { x: 0.8, y: 0.7 };
    expect(tracker.update([a], 1).map((action) => action.phase)).toEqual(["down"]);
    expect(tracker.update([a, b], 1).map((action) => [action.phase, action.points.length])).toEqual(
      [
        ["up", 1],
        ["down", 2],
      ],
    );
    expect(tracker.update([a], 1).map((action) => action.phase)).toEqual(["up"]);
    expect(tracker.update([a], 1)).toEqual([]);
    tracker.update([], 1);
    expect(tracker.update([a], 1).map((action) => action.phase)).toEqual(["down"]);
  });
  it("cancels on orientation change and ignores a third finger", () => {
    const tracker = new GestureTracker(),
      a = { x: 0.5, y: 0.5 };
    tracker.update([a], 1);
    expect(tracker.update([a], 2)).toEqual([
      { type: "touch", phase: "up", points: [a], geometry: 1 },
    ]);
    tracker.update([], 2);
    tracker.update([a, a], 2);
    expect(tracker.update([a, a, a], 2).map((action) => action.phase)).toEqual(["up"]);
  });
  it("coalesces movement and preserves down/up without replaying failed input", async () => {
    const sent: InputAction[] = [];
    let release = () => {};
    const errors: unknown[] = [];
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = new InputQueue(
      async (action) => {
        sent.push(action);
        await blocked;
      },
      (error) => errors.push(error),
    );
    const point = { x: 0.2, y: 0.3 };
    queue.push({ type: "touch", phase: "down", points: [point], geometry: 1 });
    for (let i = 0; i < 100; i++)
      queue.push({ type: "touch", phase: "move", points: [{ x: i / 100, y: 0.3 }], geometry: 1 });
    queue.push({ type: "touch", phase: "up", points: [point], geometry: 1 });
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent.map((action) => (action.type === "touch" ? action.phase : action.type))).toEqual([
      "down",
      "move",
      "up",
    ]);
    expect(errors).toEqual([]);
    queue.close();
  });
});
