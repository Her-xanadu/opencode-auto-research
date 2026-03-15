import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const innovationLoopScript = path.join(repoRoot, "scripts", "innovation_loop.py");
const hasRealDvc = spawnSync("python3", ["-c", "import shutil,sys; sys.exit(0 if shutil.which('dvc') else 1)"], {
  cwd: repoRoot,
}).status === 0;
const describeIfRealDvc = hasRealDvc ? describe : describe.skip;

async function makeWorkspace(): Promise<{ workspace: string; configPath: string }> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-python-controller-real-dvc-"));
  tempDirs.push(workspace);

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

async function runInnovationLoop(workspace: string, configPath: string, command: string, extraArgs: string[] = []): Promise<any> {
  const { stdout } = await execFileAsync(
    "python3",
    [innovationLoopScript, command, "--config", configPath, "--workspace", workspace, "--mode", "mock", ...extraArgs],
    { cwd: workspace, env: { ...process.env, CI: "true" } },
  );
  return JSON.parse(stdout);
}

async function waitForPhase(workspace: string, configPath: string, phases: string[], timeoutMs = 20000): Promise<any> {
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

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
    ),
  );
});

describeIfRealDvc("python controller with real dvc", () => {
  it("boots a real DVC workspace, applies keep, preserves discard rollback, and records DVCLive artifacts", async () => {
    const { workspace, configPath } = await makeWorkspace();

    const bootstrap = await runInnovationLoop(workspace, configPath, "bootstrap");
    expect(bootstrap.dvc_bootstrapped).toBe(true);
    expect(await fs.stat(path.join(workspace, ".dvc"))).toBeTruthy();

    const baseline = await runInnovationLoop(workspace, configPath, "tick");
    expect(baseline.phase).toBe("baseline");

    const candidate1 = await runInnovationLoop(workspace, configPath, "tick");
    expect(candidate1.phase).toBe("candidate");
    const settled1 = await waitForPhase(workspace, configPath, ["judge", "done"]);
    expect(["judge", "done"]).toContain(settled1.phase);

    const bestAfterKeep = JSON.parse(await fs.readFile(path.join(workspace, "experiments", "best.json"), "utf8"));
    expect(bestAfterKeep.exp_ref).toBe("round-0001");
    expect(bestAfterKeep.metric).toBeGreaterThan(0.8);
    expect(JSON.parse(await fs.readFile(path.join(workspace, "src", "config.json"), "utf8")).objective_mode).toBe("stability_loss_v2");
    await execFileAsync("python3", ["evaluate.py", "--stage", "full"], { cwd: workspace, env: { ...process.env, CI: "true" } });
    expect(await fs.stat(path.join(workspace, "dvclive"))).toBeTruthy();

    const candidate2 = await runInnovationLoop(workspace, configPath, "tick");
    expect(candidate2.phase).toBe("candidate");
    const settled2 = await waitForPhase(workspace, configPath, ["judge", "done"]);
    expect(settled2.judge.status).toBe("discard");
    expect(await fs.readFile(path.join(workspace, "src", "strategy.txt"), "utf8")).toBe("baseline\n");

    const { stdout: expShow } = await execFileAsync("dvc", ["exp", "show", "--json"], { cwd: workspace, env: { ...process.env, CI: "true" } });
    const expShowJson = JSON.parse(expShow);
    const showHasWorkspace = Array.isArray(expShowJson)
      ? expShowJson.some((item) => item?.rev === "workspace")
      : typeof expShowJson === "object" && expShowJson !== null && "workspace" in expShowJson;
    expect(showHasWorkspace).toBe(true);

    const resume = await runInnovationLoop(workspace, configPath, "resume");
    expect(resume.resumed).toBe(true);
    expect(resume.candidate.queued).toBe(true);
    const settled3 = await waitForPhase(workspace, configPath, ["judge", "done"]);
    expect(settled3.phase).toBe("done");
    expect(settled3.reason).toBe("goal_reached");

    const status = await runInnovationLoop(workspace, configPath, "status");
    expect(status.best_run_id).toBe("resume-0003");
    expect(status.best_exp_ref).toBe("resume-0003");
    expect(status.stop_reason).toBe("goal_reached");
    expect(status.controller_not_running).toBe(true);
  }, 45000);
});
