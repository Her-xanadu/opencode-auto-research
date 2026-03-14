import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeKbWorkspace, runPython, tempDirs } from "./test-helpers";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("kb daily tracker lite", () => {
  it("scaffolds minimal machine layer and rebuilds index", async () => {
    const { workspace, vaultRoot } = await makeKbWorkspace();
    const configPath = path.join(workspace, "configs", "research_brain.yaml");
    const result = await runPython("scripts/kb/daily_tracker_lite.py", ["--vault-root", vaultRoot, "--workspace-root", workspace, "--config", configPath], workspace);
    expect(result.index_result.paper_count).toBe(4);
    const taoClaims = await fs.readFile(path.join(vaultRoot, "tao-net", "claims.jsonl"), "utf8");
    expect(taoClaims).toContain("mechanism");
  });
});
