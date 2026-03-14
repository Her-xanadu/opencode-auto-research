import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeKbWorkspace, runPython, tempDirs } from "./test-helpers";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("kb build index", () => {
  it("builds paper, claim, method, and frontier indexes", async () => {
    const { workspace, vaultRoot } = await makeKbWorkspace();
    const outputDir = path.join(workspace, "experiments", "research", "index");
    const result = await runPython(
      "scripts/kb/build_index.py",
      [
        "--vault-root",
        vaultRoot,
        "--workspace-root",
        workspace,
        "--config",
        path.join(workspace, "configs", "research_brain.yaml"),
        "--output-dir",
        outputDir,
        "--scaffold-missing",
        "--extract-claims",
      ],
      workspace,
    );
    expect(result.paper_count).toBe(4);
    expect((await fs.readFile(path.join(outputDir, "paper-index.jsonl"), "utf8")).trim().split("\n").length).toBe(4);
    expect((await fs.readFile(path.join(outputDir, "claim-index.jsonl"), "utf8")).trim().split("\n").length).toBeGreaterThanOrEqual(12);
    expect((await fs.readFile(path.join(outputDir, "method-index.jsonl"), "utf8")).trim().split("\n").length).toBeGreaterThan(0);
    expect(await fs.readFile(path.join(outputDir, "frontier-map.json"), "utf8")).toContain("topics");
  });
});
