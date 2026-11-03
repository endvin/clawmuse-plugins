import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { PreviewError } from "./errors.js";

interface ProcessIdentity {
  pid: number;
  parent: number;
  group: number;
  state: string;
  birth: string;
}
const execFileAsync = promisify(execFile);
async function snapshot(): Promise<ProcessIdentity[]> {
  // No argv or environment values are inspected. Foundation can put descendants
  // in new process groups, so signalling only the launcher's group is insufficient.
  const { stdout } = await execFileAsync("/bin/ps", ["-axo", "pid=,ppid=,pgid=,stat=,lstart="], {
    shell: false,
    timeout: 1000,
    maxBuffer: 1024 * 1024,
  });
  const entries: ProcessIdentity[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line);
    if (match)
      entries.push({
        pid: Number(match[1]),
        parent: Number(match[2]),
        group: Number(match[3]),
        state: match[4]!,
        birth: match[5]!,
      });
  }
  return entries;
}
function kill(pid: number) {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}
export async function stopPosixTree(pid: number, closed: Promise<number | null>) {
  const before = await snapshot();
  const owned = new Map<number, ProcessIdentity>();
  for (const entry of before)
    if (entry.pid === pid || entry.group === pid) owned.set(entry.pid, entry);
  let added = true;
  while (added) {
    added = false;
    for (const entry of before)
      if (owned.has(entry.parent) && !owned.has(entry.pid)) {
        owned.set(entry.pid, entry);
        added = true;
      }
  }
  // Kill children while the launcher can still reap them, including detached groups.
  if (!owned.size) {
    await closed;
    return;
  }
  for (const entry of [...owned.values()].toReversed()) if (entry.pid !== pid) kill(entry.pid);
  await delay(20);
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
  if (owned.has(pid)) kill(pid);
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const current = await snapshot();
    const running = current.filter((entry) => {
      const original = owned.get(entry.pid);
      return original?.birth === entry.birth && !entry.state.startsWith("Z");
    });
    if (!running.length) {
      // close also joins the inherited stdio handles of the owned processes.
      await closed;
      return;
    }
    for (const entry of running) kill(entry.pid);
    await delay(50);
  }
  throw new PreviewError("预览子进程尚未退出，设备仍保持占用，请稍后重试");
}
