import type { InputAction } from "../shared/contracts.js";

export interface Point {
  x: number;
  y: number;
}
type TouchAction = Extract<InputAction, { type: "touch" }>;

export class GestureTracker {
  private current: Point[] = [];
  private geometry = 0;
  private blocked = false;
  update(points: Point[], geometry: number): TouchAction[] {
    if (this.blocked) {
      if (points.length === 0) this.blocked = false;
      return [];
    }
    if (points.length > 2 || (this.current.length > 0 && geometry !== this.geometry)) {
      const up = this.release();
      this.blocked = points.length > 0;
      return up;
    }
    if (!points.length) return this.release();
    const actions: TouchAction[] = [];
    if (this.current.length === 2 && points.length === 1) {
      actions.push(...this.release());
      this.blocked = true;
      return actions;
    }
    if (this.current.length > 0 && points.length !== this.current.length)
      actions.push(...this.release());
    const phase = this.current.length ? "move" : "down";
    this.current = points;
    this.geometry = geometry;
    actions.push({ type: "touch", phase, points, geometry });
    return actions;
  }
  release(): TouchAction[] {
    if (!this.current.length) return [];
    const action: TouchAction = {
      type: "touch",
      phase: "up",
      points: this.current,
      geometry: this.geometry,
    };
    this.current = [];
    return [action];
  }
}

export class InputQueue {
  private pending: InputAction[] = [];
  private running = false;
  private closed = false;
  constructor(
    private readonly send: (action: InputAction) => Promise<unknown>,
    private readonly onError: (error: unknown) => void,
  ) {}
  push(action: InputAction) {
    if (this.closed) return;
    const last = this.pending.at(-1);
    const coalesce =
      action.type === "touch" &&
      action.phase === "move" &&
      last?.type === "touch" &&
      last.phase === "move";
    if (coalesce) this.pending[this.pending.length - 1] = action;
    else this.pending.push(action);
    if (this.pending.length > 8) {
      this.closed = true;
      this.pending = [];
      this.onError(new Error("操作过快，请松开手指后重新连接"));
      return;
    }
    void this.drain();
  }
  close() {
    this.closed = true;
    this.pending = [];
  }
  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.closed && this.pending.length) await this.send(this.pending.shift()!);
    } catch (error) {
      this.closed = true;
      this.pending = [];
      this.onError(error);
    } finally {
      this.running = false;
    }
  }
}
