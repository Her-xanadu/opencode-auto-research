import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeKbWorkspace, runPython, tempDirs } from "./test-helpers";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("kb inference cycle", () => {
  it("runs inference-only chain when controller state exists", async () => {
    const { workspace, vaultRoot } = await makeKbWorkspace();
    const configPath = path.join(workspace, "configs", "research_brain.yaml");
    await runPython("scripts/kb/build_index.py", ["--vault-root", vaultRoot, "--workspace-root", workspace, "--config", configPath, "--scaffold-missing", "--extract-claims"], workspace);
    await fs.mkdir(path.join(workspace, "experiments"), { recursive: true });
    await fs.writeFile(path.join(workspace, "experiments", "session.json"), JSON.stringify({ iteration_count: 0, family_cooldowns: {} }, null, 2) + "\n", "utf8");
    await fs.writeFile(path.join(workspace, "experiments", "best.json"), JSON.stringify({ family: "architecture" }, null, 2) + "\n", "utf8");
    await fs.writeFile(path.join(workspace, "experiments", "attempts.jsonl"), JSON.stringify({ family: "architecture" }) + "\n", "utf8");
    await fs.writeFile(path.join(workspace, "configs", "goal.yaml"), ['goal_text: "Optimize encrypted traffic anomaly detection under drift with grounded experiment changes."', 'target_metric: "surrogate_validation_accuracy"', 'metric_direction: "maximize"'].join("\n") + "\n", "utf8");
    const result = await runPython(
      "scripts/kb/run_inference_cycle.py",
      ["--workspace-root", workspace, "--config", configPath, "--round", "1"],
      workspace,
    );
    expect(result.mode).toBe("inference");
    expect(result.skipped).toBe(false);
    expect(result.summary.selected_count).toBeGreaterThan(0);
    expect(result.summary.evidence_pack_path).toContain("evidence-round-0001.md");
  });
});
