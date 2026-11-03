import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { launch } from "./process.js";

it.skipIf(process.platform === "win32")(
  "joins detached descendants instead of only killing the launcher",
  async () => {
    const childCode = "setInterval(()=>{},1000)";
    const launcher = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{detached:true,stdio:'ignore'});process.stdout.write(String(child.pid));setInterval(()=>{},1000);`;
    const owned = launch(process.execPath, ["-e", launcher]);
    const pid = await new Promise<number>((resolve) =>
      owned.child.stdout.once("data", (bytes: Buffer) => resolve(Number(bytes.toString()))),
    );
    expect(pid).toBeGreaterThan(1);
    await owned.stop();
    const { stdout } = await promisify(execFile)("/bin/ps", ["-axo", "pid=,stat="], {
      timeout: 1000,
    });
    const running = stdout
      .split("\n")
      .filter((line) => new RegExp(`^\\s*${pid}\\s+(?!Z)`).test(line));
    expect(running).toEqual([]);
    expect(await owned.closed).toBe(null);
  },
);
