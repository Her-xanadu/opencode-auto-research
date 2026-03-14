import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  experiment_acceptance_review,
  experiment_init,
  experiment_plan_or_resume,
  experiment_prepare_sandbox,
  experiment_run_analysis,
  experiment_run_governed_workflow,
  experiment_status,
  experiment_validate_spec,
} from "../../src/tools";
import { pathExists, readJsonl } from "../../src/utils/fs";
import {
  getCompatAttemptsPath,
  getCompatBestPath,
  getCompatGoalPath,
  getCompatProposalCardsPath,
  getCompatSessionPath,
  getOrchestrationSummaryPath,
  getOrchestrationTracePath,
} from "../../src/utils/paths";

async function writeToyResearchWorkspace(workspaceRoot: string): Promise<void> {
  await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
  await fs.mkdir(path.join(workspaceRoot, "data"), { recursive: true });

  await fs.writeFile(
    path.join(workspaceRoot, "src", "config.json"),
    JSON.stringify({ learning_rate: 0.2, dropout: 0.1 }, null, 2) + "\n",
    "utf8",
  );
  await fs.writeFile(path.join(workspaceRoot, "src", "strategy.txt"), "baseline\n", "utf8");
  await fs.writeFile(path.join(workspaceRoot, "src", "module.ts"), "export const variant = 0;\n", "utf8");
  await fs.writeFile(path.join(workspaceRoot, "data", "observations.csv"), "split,value\ntrain,1\nvalid,1\n", "utf8");
  await fs.writeFile(
    path.join(workspaceRoot, "evaluate.py"),
    [
      "import json",
      "import pathlib",
      "import re",
      "",
      "cfg = json.loads(pathlib.Path('src/config.json').read_text())",
      "strategy = pathlib.Path('src/strategy.txt').read_text().strip()",
      "module_text = pathlib.Path('src/module.ts').read_text()",
      "match = re.search(r'(\\d+)', module_text)",
      "variant = int(match.group(1)) if match else 0",
      "lr = float(cfg['learning_rate'])",
      "score = 0.7 + max(0.0, 0.2 - abs(lr - 0.75)) * 1.2",
      "if strategy.startswith('variant_'):",
      "    score += 0.01",
      "score += min(variant, 2) * 0.005",
      "print(min(0.99, round(score, 4)))",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function main() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-scientific-task-"));
  await writeToyResearchWorkspace(workspaceRoot);

  const spec = {
    workspace_root: workspaceRoot,
    editable_paths: ["src/**"],
    read_only_paths: ["data/**"],
    eval_command: "python3 evaluate.py",
    eval_parser: "number",
    primary_metric: "surrogate_validation_accuracy",
    metric_direction: "maximize" as const,
    max_iterations: 3,
    max_hours: 1,
    stop_rule: { metric_threshold: 0.9, max_no_improvement_rounds: 2 },
  };

  const validation = JSON.parse(await experiment_validate_spec.execute({ spec }));
  if (!validation.valid) {
    throw new Error(`scientific task spec invalid: ${JSON.stringify(validation.errors)}`);
  }

  const init = JSON.parse(await experiment_init.execute({ workspace_root: workspaceRoot, spec }));
  const sandbox = JSON.parse(
    await experiment_prepare_sandbox.execute({
      workspace_root: workspaceRoot,
      editable_paths: ["src/**"],
      read_only_paths: ["data/**"],
      allowed_runtime_outputs: ["outputs/**"],
      sample_write_path: "src/config.json",
    }),
  );
  const planned = JSON.parse(await experiment_plan_or_resume.execute({ workspace_root: workspaceRoot }));
  const workflow = JSON.parse(await experiment_run_governed_workflow.execute({ workspace_root: workspaceRoot }));
  const analysis = JSON.parse(await experiment_run_analysis.execute({ workspace_root: workspaceRoot }));
  const status = JSON.parse(await experiment_status.execute({ workspace_root: workspaceRoot }));
  const acceptance = JSON.parse(await experiment_acceptance_review.execute({ workspace_root: workspaceRoot }));

  const trace = await readJsonl<{ actor: string }>(getOrchestrationTracePath(workspaceRoot));
  const attempts = await readJsonl<{ run_id: string; current_metric: number; status: string }>(getCompatAttemptsPath(workspaceRoot));
  const proposalCards = await readJsonl(getCompatProposalCardsPath(workspaceRoot));

  const artifactPresence = {
    compat_goal: await pathExists(getCompatGoalPath(workspaceRoot)),
    compat_session: await pathExists(getCompatSessionPath(workspaceRoot)),
    compat_best: await pathExists(getCompatBestPath(workspaceRoot)),
    orchestration_summary: await pathExists(getOrchestrationSummaryPath(workspaceRoot)),
  };

  if (sandbox.status !== "ready") {
    throw new Error(`sandbox preflight failed: ${JSON.stringify(sandbox)}`);
  }
  if (workflow.stop_reason !== "goal_reached") {
    throw new Error(`expected goal_reached, got ${workflow.stop_reason}`);
  }
  if ((status.best?.current_best?.metric ?? 0) < 0.9) {
    throw new Error(`best metric too low: ${status.best?.current_best?.metric ?? null}`);
  }
  if (attempts.length < 2) {
    throw new Error(`expected at least 2 attempts, got ${attempts.length}`);
  }
  const actors = trace.map((step) => step.actor);
  for (const expectedActor of ["Apollo", "Athena", "Hermes", "sisyphus-junior", "status_poll.py", "judge_result.py"]) {
    if (!actors.includes(expectedActor)) {
      throw new Error(`missing orchestration actor: ${expectedActor}`);
    }
  }
  if (!artifactPresence.compat_goal || !artifactPresence.compat_session || !artifactPresence.compat_best || !artifactPresence.orchestration_summary) {
    throw new Error(`artifact presence check failed: ${JSON.stringify(artifactPresence)}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        task: "toy-scientific-learning-rate-optimization",
        workspace_root: workspaceRoot,
        init_stage: init.session_stage,
        planned_stage: planned.stage,
        sandbox_status: sandbox.status,
        workflow: {
          stop_reason: workflow.stop_reason,
          total_iterations: workflow.total_iterations,
          best_metric: workflow.best_metric,
          latest_decision: workflow.latest_decision,
          active_run_id: workflow.active_run_id,
        },
        analysis,
        acceptance,
        artifacts: {
          ...artifactPresence,
          attempts_count: attempts.length,
          proposal_cards_count: proposalCards.length,
          trace_actors: trace.map((step) => step.actor),
        },
        best_run: status.best?.current_best ?? null,
        attempts,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
