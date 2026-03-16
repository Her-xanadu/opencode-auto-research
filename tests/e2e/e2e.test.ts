import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { experiment_execute_iteration, experiment_init, experiment_run_analysis, experiment_run_governed_workflow, experiment_status } from "../../src/tools";
import { readJsonl } from "../../src/utils/fs";
import { getOrchestrationTracePath, getRecoveryCheckpointPath } from "../../src/utils/paths";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-e2e-"));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.writeFile(path.join(dir, "src", "config.json"), '{"learning_rate":0.1}\n', "utf8");
  await fs.writeFile(path.join(dir, "src", "strategy.txt"), "baseline\n", "utf8");
  await fs.writeFile(path.join(dir, "src", "module.ts"), "export const variant = 0;\n", "utf8");
  await fs.writeFile(path.join(dir, "evaluate.py"), "print(0.93)\n", "utf8");
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })));
});

describe("local e2e", () => {
  it("initializes, executes, analyzes, loops, and reports best result", async () => {
    const workspace = await makeWorkspace();
    await experiment_init.execute({
      workspace_root: workspace,
      spec: {
        editable_paths: ["src/**"],
        read_only_paths: ["data/**"],
        eval_command: "python3 -c 'print(0.93)'",
        eval_parser: "number",
        primary_metric: "accuracy",
        metric_direction: "maximize",
        max_iterations: 3,
        max_hours: 1,
        stop_rule: { metric_threshold: 0.92, max_no_improvement_rounds: 1 },
      },
    });
    await experiment_execute_iteration.execute({
      workspace_root: workspace,
      mutation: {
        change_class: "hyperparameter",
        change_unit: "learning_rate",
        target_file: "src/config.json",
        params: { key: "learning_rate", value: 0.9 },
      },
    });
    const analysis = JSON.parse(await experiment_run_analysis.execute({ workspace_root: workspace }));
    await fs.mkdir(path.dirname(getRecoveryCheckpointPath(workspace)), { recursive: true });
    await fs.writeFile(
      getRecoveryCheckpointPath(workspace),
      JSON.stringify({ run_id: "recoverable-run", checkpoint_path: "checkpoints/latest.ckpt", parent_run_id: "parent-run" }, null, 2),
      "utf8",
    );
    const workflow = JSON.parse(await experiment_run_governed_workflow.execute({ workspace_root: workspace }));
    const status = JSON.parse(await experiment_status.execute({ workspace_root: workspace }));
    const steps = await readJsonl<{ actor: string }>(getOrchestrationTracePath(workspace));
    expect(analysis.why_selected || analysis.why_not_others).toBeTruthy();
    expect(workflow.total_iterations).toBeGreaterThan(0);
    expect(steps.map((step) => step.actor)).toEqual(
      expect.arrayContaining([
        "Apollo",
        "Athena",
        "Hermes",
        "sisyphus-junior",
        "status_poll.py",
        "judge_result.py",
      ]),
    );
    expect(status.best.current_best.metric).toBeGreaterThan(0.5);
  }, 60000);
});
