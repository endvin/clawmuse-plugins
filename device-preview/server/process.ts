import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import { PreviewError } from "./errors.js";
import { stopPosixTree } from "./posix-tree.js";

export interface OwnedProcess {
  child: ChildProcessWithoutNullStreams;
  closed: Promise<number | null>;
  stop(): Promise<void>;
}

export function launch(tool: string, args: string[]): OwnedProcess {
  const child = spawn(tool, args, {
    shell: false,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: "pipe",
  });
  // Diagnostics can contain simulator data. Never forward or retain stderr.
  child.stderr.resume();
  child.stdin.on("error", () => {});
  child.on("error", () => {});
  let finished = false;
  const closed = new Promise<number | null>((resolve) =>
    child.once("close", (code) => {
      finished = true;
      resolve(code);
    }),
  );
  let stopping: Promise<void> | null = null;
  async function terminate() {
    if (finished) return;
    if (child.pid === undefined) {
      await closed;
      return;
    }
    if (process.platform === "win32") {
      const killer = spawn(
        join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
        ["/PID", String(child.pid), "/T", "/F"],
        { shell: false, windowsHide: true, stdio: "ignore" },
      );
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          killer.kill("SIGKILL");
          reject(new PreviewError("预览子进程树清理超时，设备仍保持占用"));
        }, 3000);
        killer.once("error", () => {
          clearTimeout(timeout);
          reject(new PreviewError("无法清理预览子进程树"));
        });
        killer.once("close", (code) => {
          clearTimeout(timeout);
          if (code !== 0 && !finished) {
            reject(new PreviewError("无法确认预览子进程树已退出"));
            return;
          }
          resolve();
        });
      });
      await closed;
      return;
    }
    await stopPosixTree(child.pid, closed);
  }
  return {
    child,
    closed,
    stop() {
      stopping ??= terminate();
      return stopping;
    },
  };
}

export interface CommandOptions {
  signal: AbortSignal;
  timeout?: number;
  maxBytes?: number;
}
export async function command(
  tool: string,
  args: string[],
  options: CommandOptions,
): Promise<Buffer> {
  options.signal.throwIfAborted();
  const owned = launch(tool, args);
  const chunks: Buffer[] = [];
  let bytes = 0;
  let cancelled = false;
  let termination: Promise<void> | null = null;
  const abort = () => {
    cancelled = true;
    termination ??= owned.stop();
    void termination.catch(() => {});
  };
  const timer = setTimeout(abort, options.timeout ?? 10_000);
  options.signal.addEventListener("abort", abort, { once: true });
  owned.child.stdout.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > (options.maxBytes ?? 1024 * 1024)) {
      abort();
      return;
    }
    if (!cancelled) chunks.push(chunk);
  });
  owned.child.stdin.end();
  try {
    const code = await owned.closed;
    if (termination) await termination;
    if (cancelled || code !== 0)
      throw new PreviewError("工具未完成操作，设备可能尚未就绪；请刷新后重试");
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener("abort", abort);
  }
}
