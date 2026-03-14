import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { experiment_execute_iteration, experiment_init, experiment_status } from "../../src/tools";

async function main() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-smoke-"));
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.writeFile(path.join(workspace, "src", "config.json"), '{"learning_rate":0.1}\n', "utf8");
  await fs.writeFile(path.join(workspace, "src", "strategy.txt"), "baseline\n", "utf8");
  await fs.writeFile(path.join(workspace, "src", "module.ts"), "export const variant = 0;\n", "utf8");
  await experiment_init.execute({
    workspace_root: workspace,
    spec: {
      editable_paths: ["src/**"],
      read_only_paths: ["data/**"],
      eval_command: "python3 -c 'print(0.88)'",
      eval_parser: "number",
      primary_metric: "accuracy",
      metric_direction: "maximize",
      max_iterations: 3,
      max_hours: 1,
      stop_rule: { metric_threshold: 0.9, max_no_improvement_rounds: 1 },
    },
  });
  await experiment_execute_iteration.execute({
    workspace_root: workspace,
    mutation: {
      change_class: "hyperparameter",
      change_unit: "learning_rate",
      target_file: "src/config.json",
      params: { key: "learning_rate", value: 0.7 },
    },
  });
  const status = JSON.parse(await experiment_status.execute({ workspace_root: workspace }));
  if (!status.session) {
    throw new Error("missing session state");
  }
  console.log(JSON.stringify({ ok: true, stage: status.session.stage, best: status.best?.current_best ?? null }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
