import { describe, expect, it } from "vitest";
import { command, launch } from "./process.js";
describe("owned preview subprocesses", () => {
  it("caps output and joins a cancelled process before returning", async () => {
    await expect(
      command(
        process.execPath,
        ["-e", "process.stdout.write('x'.repeat(100000));setInterval(()=>{},1000)"],
        { signal: AbortSignal.timeout(3000), maxBytes: 1024 },
      ),
    ).rejects.toThrow("未完成");
    const owned = launch(process.execPath, [
      "-e",
      "process.stdout.write('ready');setInterval(()=>{},1000)",
    ]);
    await new Promise<void>((resolve) => owned.child.stdout.once("data", () => resolve()));
    await owned.stop();
    expect(await owned.closed).not.toBe(0);
  });
  it("passes argv literally without invoking a shell", async () => {
    const literal = "a; echo $HOME | cat\n'quoted'";
    const result = await command(
      process.execPath,
      ["-e", "process.stdout.write(process.argv[1])", literal],
      { signal: AbortSignal.timeout(3000) },
    );
    expect(result.toString()).toBe(literal);
  });
});
