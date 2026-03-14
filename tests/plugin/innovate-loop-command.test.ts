import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { experimentCommands } from "../../src/commands";
import { experiment_init } from "../../src/tools";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-innovate-loop-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("innovate-loop command", () => {
  it("describes a Sisyphus-led loop with single executor constraints", async () => {
    const workspaceRoot = await makeWorkspace();
    await experiment_init.execute({
      workspace_root: workspaceRoot,
      spec: {
        editable_paths: ["src/**"],
        read_only_paths: ["data/**"],
        eval_command: "python3 -c 'print(0.8)'",
        eval_parser: "number",
        primary_metric: "accuracy",
        metric_direction: "maximize",
        max_iterations: 3,
        max_hours: 1,
        stop_rule: { metric_threshold: 0.9, max_no_improvement_rounds: 1 },
      },
    });
    const goalYaml = await fs.readFile(path.join(workspaceRoot, "configs", "goal.yaml"), "utf8");
    const session = JSON.parse(await fs.readFile(path.join(workspaceRoot, "experiments", "session.json"), "utf8"));
    expect(experimentCommands["innovate-loop"].description).toMatch(/Sisyphus/i);
    expect(experimentCommands["innovate-loop"].template).toContain("configs/goal.yaml");
    expect(experimentCommands["innovate-loop"].template).toContain("sisyphus-junior");
    expect(experimentCommands["innovate-loop"].template).toContain("Prometheus");
    expect(goalYaml).toContain("target_metric: accuracy");
    expect(goalYaml).toContain("editable_paths:");
    expect(["spec_drafting", "baseline_running", "ready_to_execute"]).toContain(session.stage);
  });
});
