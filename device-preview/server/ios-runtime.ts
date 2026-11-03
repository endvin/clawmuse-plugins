import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, mkdtemp, lstat, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { command } from "./process.js";
import { PreviewError } from "./errors.js";

// Upstream release assets were verified against GitHub's asset SHA-256 metadata.
export const runtimeArtifact = {
  version: "0.2.12",
  url: "https://github.com/tddworks/baguette/releases/download/v0.2.12/baguette_v0.2.12_macOS_arm64.tar.gz",
  archiveHash: "32c21cc91c1d3b930bb01e9404139608e6d1ae1d274ef83b4f9dc68d99d8eeac",
  binaryHash: "3c1d93480781928ccc70d3a7f35669250e17510ffde4db588dabbbe319379e6e",
  member: "baguette-v0.2.12-macOS-arm64/Baguette",
} as const;
const MAX_ARCHIVE = 40 * 1024 * 1024;

async function verified(file: string): Promise<boolean> {
  try {
    const metadata = await lstat(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 16 * 1024 * 1024)
      return false;
    const hash = createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
    return hash === runtimeArtifact.binaryHash;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw new PreviewError("无法验证 iOS 预览组件");
  }
}

export function createIosRuntime() {
  const root = join(
    process.env.PASEO_HOME ?? join(homedir(), ".paseo"),
    "device-preview",
    "runtimes",
    runtimeArtifact.version,
  );
  const binary = join(root, "Baguette");
  let preparing: Promise<string> | null = null;
  async function install(signal: AbortSignal): Promise<string> {
    if (await verified(binary)) return binary;
    await mkdir(root, { recursive: true, mode: 0o700 });
    const staging = await mkdtemp(join(root, "prepare-"));
    const archive = join(staging, "runtime.tar.gz");
    try {
      const timeout = AbortSignal.timeout(90_000);
      const response = await fetch(runtimeArtifact.url, {
        signal: AbortSignal.any([signal, timeout]),
        redirect: "follow",
      });
      if (!response.ok || !response.body)
        throw new PreviewError("无法获取 iOS 预览组件，请检查主机网络后重试");
      const file = await open(archive, "wx", 0o600),
        hash = createHash("sha256");
      let bytes = 0;
      try {
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > MAX_ARCHIVE) throw new PreviewError("iOS 预览组件超过下载上限");
          hash.update(chunk);
          await file.writeFile(chunk);
        }
      } finally {
        await file.close();
      }
      if (hash.digest("hex") !== runtimeArtifact.archiveHash)
        throw new PreviewError("iOS 预览组件校验失败，已拒绝运行");
      // Extract only the verified executable, never archives' paths or bundled plugins.
      const contents = await command("/usr/bin/tar", ["-xOf", archive, runtimeArtifact.member], {
        signal,
        maxBytes: 16 * 1024 * 1024,
        timeout: 15_000,
      });
      if (createHash("sha256").update(contents).digest("hex") !== runtimeArtifact.binaryHash)
        throw new PreviewError("iOS 预览组件可执行文件校验失败");
      const output = join(staging, "Baguette");
      const handle = await open(output, "wx", 0o700);
      try {
        await handle.writeFile(contents);
      } finally {
        await handle.close();
      }
      await chmod(output, 0o700);
      signal.throwIfAborted();
      await rename(output, binary);
      return binary;
    } catch (error) {
      if (error instanceof PreviewError) throw error;
      throw new PreviewError("iOS 预览组件准备失败或已取消，请重试");
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  return {
    async ensure(signal: AbortSignal) {
      preparing ??= install(signal).finally(() => {
        preparing = null;
      });
      return preparing;
    },
  };
}
