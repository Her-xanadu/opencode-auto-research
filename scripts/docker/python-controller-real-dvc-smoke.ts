import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const repoRoot = process.cwd();
const innovationLoopScript = path.join(repoRoot, "scripts", "innovation_loop.py");

async function makeWorkspace(): Promise<{ workspace: string; configPath: string }> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-real-dvc-smoke-"));
  await fs.mkdir(path.join(workspace, "configs"), { recursive: true });
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.mkdir(path.join(workspace, "data"), { recursive: true });

  await fs.writeFile(
    path.join(workspace, "src", "config.json"),
    JSON.stringify({ learning_rate: 0.2, dropout: 0.1, objective_mode: "baseline" }, null, 2) + "\n",
    "utf8",
  );
  await fs.writeFile(path.join(workspace, "src", "strategy.txt"), "baseline\n", "utf8");
  await fs.writeFile(path.join(workspace, "src", "module.ts"), "export const variant = 0;\n", "utf8");
  await fs.writeFile(path.join(workspace, "data", "observations.csv"), "split,value\ntrain,1\nvalid,1\n", "utf8");
  await fs.writeFile(
    path.join(workspace, "evaluate.py"),
    [
      "import argparse",
      "import json",
      "import pathlib",
      "import re",
      "import time",
      "",
      "parser = argparse.ArgumentParser()",
      "parser.add_argument('--stage', default='baseline')",
      "parser.add_argument('--resume-from')",
      "args = parser.parse_args()",
      "",
      "cfg = json.loads(pathlib.Path('src/config.json').read_text())",
      "strategy = pathlib.Path('src/strategy.txt').read_text().strip()",
      "module_text = pathlib.Path('src/module.ts').read_text()",
      "match = re.search(r'(\\d+)', module_text)",
      "variant = int(match.group(1)) if match else 0",
      "score = 0.72",
      "if cfg.get('objective_mode') == 'stability_loss_v2':",
      "    score += 0.14",
      "if strategy == 'variant_2':",
      "    score -= 0.03",
      "elif strategy == 'variant_3':",
      "    score += 0.01",
      "if variant >= 2:",
      "    score += 0.06",
      "score = min(0.99, round(score, 4))",
      "metrics_path = pathlib.Path('experiments/metrics.json')",
      "metrics_path.parent.mkdir(parents=True, exist_ok=True)",
      "checkpoint = pathlib.Path('experiments/checkpoints/last.ckpt')",
      "checkpoint.parent.mkdir(parents=True, exist_ok=True)",
      "checkpoint.write_text('checkpoint\\n')",
      "if args.stage == 'full':",
      "    time.sleep(1.2)",
      "try:",
      "    from dvclive import Live",
      "except Exception:",
      "    Live = None",
      "if Live is not None and args.stage == 'full':",
      "    with Live(dir='dvclive', resume=bool(args.resume_from), monitor_system=False, save_dvc_exp=False, dvcyaml=False) as live:",
      "        live.log_param('stage', args.stage)",
      "        live.log_metric('score', score)",
      "        try:",
      "            import psutil",
      "            live.log_metric('system_cpu_percent', psutil.cpu_percent(interval=None))",
      "            live.log_metric('system_memory_mb', round(psutil.virtual_memory().used / (1024 * 1024), 2))",
      "        except Exception:",
      "            pass",
      "        live.log_artifact(str(checkpoint), type='checkpoint')",
      "        live.next_step()",
      "metrics_path.write_text(json.dumps({'score': score, 'stage': args.stage, 'resume_from': args.resume_from}, indent=2) + '\\n')",
      "print(score)",
      "",
    ].join("\n"),
    "utf8",
  );

  return { workspace, configPath: path.join(workspace, "configs", "goal.yaml") };
}

async function runInnovationLoop(workspace: string, configPath: string, command: string, extraArgs: string[] = []) {
  const { stdout } = await execFileAsync(
    "python3",
    [innovationLoopScript, command, "--config", configPath, "--workspace", workspace, ...extraArgs],
    { cwd: workspace, env: { ...process.env, CI: "true" } },
  );
  return JSON.parse(stdout);
}

async function waitForPhase(workspace: string, configPath: string, phases: string[], timeoutMs = 25000): Promise<any> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await runInnovationLoop(workspace, configPath, "tick");
    if (phases.includes(result.phase)) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for phases: ${phases.join(", ")}`);
}

async function main() {
  const { workspace, configPath } = await makeWorkspace();

  const bootstrap = await runInnovationLoop(workspace, configPath, "bootstrap");
  const baseline = await runInnovationLoop(workspace, configPath, "tick");
  const candidate1 = await runInnovationLoop(workspace, configPath, "tick");
  const settled1 = await waitForPhase(workspace, configPath, ["judge", "done"]);
  const candidate2 = await runInnovationLoop(workspace, configPath, "tick");
  const settled2 = await waitForPhase(workspace, configPath, ["judge", "done"]);
  const resume = await runInnovationLoop(workspace, configPath, "resume");
  const settled3 = await waitForPhase(workspace, configPath, ["judge", "done"]);
  const status = await runInnovationLoop(workspace, configPath, "status");
  const proposalsRound1 = JSON.parse(await fs.readFile(path.join(workspace, "experiments", "proposals", "round-0001.json"), "utf8"));
  const best = JSON.parse(await fs.readFile(path.join(workspace, "experiments", "best.json"), "utf8"));
  const attempts = (await fs.readFile(path.join(workspace, "experiments", "attempts.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const { stdout: expShow } = await execFileAsync("dvc", ["exp", "show", "--json"], { cwd: workspace, env: { ...process.env, CI: "true" } });
  const expShowJson = JSON.parse(expShow);
  const showHasWorkspace = Array.isArray(expShowJson)
    ? expShowJson.some((item) => item?.rev === "workspace")
    : typeof expShowJson === "object" && expShowJson !== null && "workspace" in expShowJson;
  const showHasRound1 = Array.isArray(expShowJson)
    ? expShowJson.some((item) => Array.isArray(item?.experiments) && item.experiments.some((exp: any) => exp?.name === "round-0001"))
    : JSON.stringify(expShowJson).includes("round-0001");

  if (!bootstrap.dvc_bootstrapped) {
    throw new Error(`expected real DVC bootstrap, got ${JSON.stringify(bootstrap)}`);
  }
  if (baseline.phase !== "baseline") {
    throw new Error(`baseline phase mismatch: ${JSON.stringify(baseline)}`);
  }
  if (candidate1.phase !== "candidate" || !candidate1.candidate.queued) {
    throw new Error(`candidate1 did not queue correctly: ${JSON.stringify(candidate1)}`);
  }
  if (settled1.judge?.status !== "keep" && settled1.phase !== "done") {
    throw new Error(`first real DVC round did not keep: ${JSON.stringify(settled1)}`);
  }
  if (candidate2.phase !== "candidate" || !candidate2.candidate.queued) {
    throw new Error(`candidate2 did not queue correctly: ${JSON.stringify(candidate2)}`);
  }
  if (settled2.judge?.status !== "discard") {
    throw new Error(`second real DVC round did not discard: ${JSON.stringify(settled2)}`);
  }
  if (!resume.resumed || !resume.candidate?.queued) {
    throw new Error(`resume did not queue correctly: ${JSON.stringify(resume)}`);
  }
  if (settled3.phase !== "done" || settled3.reason !== "goal_reached") {
    throw new Error(`third round did not finish with goal_reached: ${JSON.stringify(settled3)}`);
  }
  if (!showHasWorkspace) {
    throw new Error(`unexpected dvc exp show output: ${expShow}`);
  }
  if (!showHasRound1) {
    throw new Error(`missing round-0001 in dvc exp show output: ${expShow}`);
  }
  if (!best.exp_ref || best.exp_ref !== "resume-0003") {
    throw new Error(`best exp ref mismatch: ${JSON.stringify(best)}`);
  }
  if (!status.controller_not_running) {
    throw new Error(`controller status mismatch: ${JSON.stringify(status)}`);
  }
  if (status.stop_reason !== "goal_reached") {
    throw new Error(`final stop reason mismatch: ${JSON.stringify(status)}`);
  }
  if (!attempts.some((item: any) => item.decision === "keep") || !attempts.some((item: any) => item.decision === "discard")) {
    throw new Error(`attempt ledger missing keep/discard coverage: ${JSON.stringify(attempts)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    task: "real-python-controller-dvc-toy-scientific-loop",
    workspace,
    bootstrap,
    best,
    status,
    attempts,
    proposals_round_1: proposalsRound1,
    dvc_exp_show: expShowJson,
    resume,
    settled3,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
