import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeKbWorkspace, runPython, tempDirs } from "./test-helpers";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("kb organize vault", () => {
  it("moves stray root-level paper assets back into their paper directories", async () => {
    const { workspace, vaultRoot } = await makeKbWorkspace();
    await fs.writeFile(path.join(vaultRoot, "TAO-Net_Review.md"), "# TAO review\n", "utf8");
    await fs.writeFile(path.join(vaultRoot, "Mazu_Architecture.canvas"), "{}\n", "utf8");
    const result = await runPython("scripts/kb/organize_vault.py", ["--vault-root", vaultRoot], workspace);
    expect(result.moved_count).toBe(2);
    await expect(fs.readFile(path.join(vaultRoot, "tao-net", "TAO-Net_Review.md"), "utf8")).resolves.toContain("TAO review");
    await expect(fs.readFile(path.join(vaultRoot, "mazu", "Mazu_Architecture.canvas"), "utf8")).resolves.toContain("{}");
  });
});
