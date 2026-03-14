import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeKbWorkspace, runPython, tempDirs } from "./test-helpers";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("kb scaffold and validate", () => {
  it("creates paper.meta.yaml and figure-note.md stubs for missing machine layer files", async () => {
    const { workspace, vaultRoot } = await makeKbWorkspace();
    const result = await runPython(
      "scripts/kb/build_index.py",
      ["--vault-root", vaultRoot, "--workspace-root", workspace, "--config", path.join(workspace, "configs", "research_brain.yaml"), "--scaffold-missing"],
      workspace,
    );
    expect(result.paper_count).toBeGreaterThan(0);
    const taoMeta = await fs.readFile(path.join(vaultRoot, "tao-net", "paper.meta.yaml"), "utf8");
    const taoFigure = await fs.readFile(path.join(vaultRoot, "tao-net", "figure-note.md"), "utf8");
    expect(taoMeta).toContain("paper_id:");
    expect(taoFigure).toContain("主要模块");
  });
});
