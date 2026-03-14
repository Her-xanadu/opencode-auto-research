import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeKbWorkspace, runPython, tempDirs } from "./test-helpers";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("kb standardize vault format", () => {
  it("renames markdown and canvas to match folder title and keeps english pdf naming", async () => {
    const { workspace, vaultRoot } = await makeKbWorkspace();
    const taoDir = path.join(vaultRoot, "tao-net");
    await fs.rename(path.join(taoDir, "tao-net.md"), path.join(taoDir, "TAO-Net_Review.md"));
    await fs.rename(path.join(taoDir, "tao-net-架构图.canvas"), path.join(taoDir, "TAO-Net_Architecture.canvas"));
    await runPython("scripts/kb/standardize_vault_format.py", ["--vault-root", vaultRoot], workspace);
    await expect(fs.readFile(path.join(taoDir, "tao-net.md"), "utf8")).resolves.toContain("# tao-net");
    await expect(fs.readFile(path.join(taoDir, "tao-net-架构图.canvas"), "utf8")).resolves.toContain("{}");
    const meta = await fs.readFile(path.join(taoDir, "paper.meta.yaml"), "utf8");
    expect(meta).toContain("title_zh: tao-net");
  });
});
