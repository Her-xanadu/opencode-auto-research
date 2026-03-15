import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeKbWorkspace, runPython, tempDirs } from "./test-helpers";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("kb maintenance cycle", () => {
  it("runs maintenance-only chain without inference artifacts", async () => {
    const { workspace, vaultRoot } = await makeKbWorkspace();
    const configPath = path.join(workspace, "configs", "research_brain.yaml");
    const result = await runPython(
      "scripts/kb/run_maintenance_cycle.py",
      ["--vault-root", vaultRoot, "--workspace-root", workspace, "--config", configPath],
      workspace,
    );
    expect(result.mode).toBe("maintenance");
    expect(result.summary.paper_count).toBe(4);
    await expect(fs.stat(path.join(workspace, "experiments", "research", "evidence-round-0001.md"))).rejects.toThrow();
  });
});
