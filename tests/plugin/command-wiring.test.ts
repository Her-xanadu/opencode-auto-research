import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROMETHEUS_PLANNER_AGENT, SISYPHUS_ORCHESTRATOR_AGENT } from "../../src/agents";
import { experimentCommands } from "../../src/commands";
import { experiment_init, experiment_plan_or_resume, experiment_status } from "../../src/tools";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-command-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("command wiring", () => {
  it("exposes experiment commands and session lifecycle tools", async () => {
    const workspaceRoot = await makeTempDir();
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
    const plan = JSON.parse(await experiment_plan_or_resume.execute({ workspace_root: workspaceRoot }));
    const status = JSON.parse(await experiment_status.execute({ workspace_root: workspaceRoot }));
    expect(Object.keys(experimentCommands)).toEqual(
      expect.arrayContaining(["innovate-loop", "experiment-init", "experiment-run", "experiment-status", "research-context", "experiment-bootstrap"]),
    );
    expect(experimentCommands["experiment-run"].agent).toBe(SISYPHUS_ORCHESTRATOR_AGENT);
    expect(experimentCommands["innovate-loop"].agent).toBe(SISYPHUS_ORCHESTRATOR_AGENT);
    expect(experimentCommands["research-context"].agent).toBe(SISYPHUS_ORCHESTRATOR_AGENT);
    expect(experimentCommands["experiment-bootstrap"].agent).toBe(PROMETHEUS_PLANNER_AGENT);
    expect(["spec_drafting", "ready_to_execute", "idle"]).toContain(plan.stage);
    expect(status.session.stage).toBe(plan.stage);
  });
});
