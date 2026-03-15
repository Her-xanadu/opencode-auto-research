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
const hasDvc = spawnSync("python3", ["-c", "import shutil,sys; sys.exit(0 if shutil.which('dvc') else 1)"], {
  cwd: repoRoot,
}).status === 0;

async function makeWorkspace(): Promise<{ workspace: string; configPath: string }> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-python-controller-"));
  tempDirs.push(workspace);

  await fs.mkdir(path.join(workspace, "configs"), { recursive: true });
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.mkdir(path.join(workspace, "data"), { recursive: true });
  await fs.cp(path.join(repoRoot, "fixtures", "kb", "vault"), path.join(workspace, "vault"), { recursive: true });

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
      "    time.sleep(0.4)",
      "metrics_path.write_text(json.dumps({'score': score, 'stage': args.stage, 'resume_from': args.resume_from}, indent=2) + '\\n')",
      "print(score)",
      "",
    ].join("\n"),
    "utf8",
  );

  await fs.writeFile(
    path.join(workspace, "configs", "research_brain.yaml"),
    [
      `vault_root: ${path.join(workspace, "vault")}`,
      "index_output_dir: experiments/research/index",
      "retrieval_cache_dir: experiments/research/retrieval-cache",
      "evidence_output_dir: experiments/research",
      "feedback_output: experiments/research/paper-feedback.jsonl",
      "posterior_rank_output: experiments/research/posterior-rank.json",
      "paper_id_map_output: experiments/research/paper-id-map.jsonl",
      "frontier_map_output: experiments/research/index/frontier-map.json",
    ].join("\n") + "\n",
    "utf8",
  );

  return { workspace, configPath: path.join(workspace, "configs", "goal.yaml") };
}

async function runInnovationLoop(
  workspace: string,
  configPath: string,
  command: string,
  extraArgs: string[] = [],
  env: NodeJS.ProcessEnv = {},
): Promise<any> {
  const { stdout } = await execFileAsync(
    "python3",
    [innovationLoopScript, command, "--config", configPath, "--workspace", workspace, "--mode", "mock", ...extraArgs],
    {
      cwd: workspace,
      env: { ...process.env, ...env },
    },
  );
  return JSON.parse(stdout);
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`condition not satisfied within ${timeoutMs}ms`);
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
    ),
  );
});

describe("python controller cli", () => {
  it("runs bootstrap, tick lifecycle, status, and resume", async () => {
    const { workspace, configPath } = await makeWorkspace();

    const bootstrap = await runInnovationLoop(workspace, configPath, "bootstrap");
    expect(bootstrap.unresolved_fields).toEqual([]);
    expect(Boolean(bootstrap.dvc_bootstrapped)).toBe(hasDvc);

    const baseline = await runInnovationLoop(workspace, configPath, "tick");
    expect(baseline.phase).toBe("baseline");

    const candidate = await runInnovationLoop(workspace, configPath, "tick");
    expect(candidate.phase).toBe("candidate");
    expect(candidate.candidate.queued).toBe(true);

    const poll = await runInnovationLoop(workspace, configPath, "tick");
    if (poll.phase === "poll") {
      expect(poll.poll.status).toMatch(/queued|running/);
    }

    const judge = poll.phase === "judge" ? poll : await runInnovationLoop(workspace, configPath, "tick");
    expect(judge.phase).toBe("judge");
    expect(judge.judge.status).toBe("keep");

     const proposalsRound1 = JSON.parse(await fs.readFile(path.join(workspace, "experiments", "proposals", "round-0001.json"), "utf8"));
     expect(proposalsRound1.next_primary_hypothesis.family).toBe("objective.loss");
      expect(proposalsRound1.next_primary_hypothesis.paper_grounding).toHaveLength(2);
      expect(proposalsRound1.evidence_pack_path).toContain("evidence-round-0001.md");
      await expect(fs.readFile(path.join(workspace, "experiments", "research", "evidence-round-0001.md"), "utf8")).resolves.toContain("推荐论文 1（高度相关）");

    const candidate2 = await runInnovationLoop(workspace, configPath, "tick");
    expect(candidate2.phase).toBe("candidate");

    const poll2 = await runInnovationLoop(workspace, configPath, "tick");
    const judge2 = poll2.phase === "judge" ? poll2 : await runInnovationLoop(workspace, configPath, "tick");
    expect(judge2.phase).toBe("judge");
    expect(judge2.judge.status).toBe("discard");

    const status = await runInnovationLoop(workspace, configPath, "status");
    expect(status.loop_id).toBeTruthy();
    expect(status.state).toBe("ready_to_execute");
    expect(status.best_run_id).toBe("round-0001");
    expect(status.best_exp_ref).toBe("round-0001");
    expect(status.active_dvc_task).toBeNull();
    expect(status.iteration_count).toBe(2);
    expect(status.controller_not_running).toBe(true);

    const resume = await runInnovationLoop(workspace, configPath, "resume");
    expect(resume.resumed).toBe(true);
    expect(resume.candidate.queued).toBe(true);
  }, 45000);

  it("supports detached start and stop", async () => {
    const { workspace, configPath } = await makeWorkspace();

    await runInnovationLoop(workspace, configPath, "bootstrap");
    const started = await runInnovationLoop(workspace, configPath, "start", ["--detached"], {
      INNOVATION_LOOP_POLL_INTERVAL: "1",
    });
    expect(started.detached).toBe(true);

    await waitFor(async () => {
      const status = await runInnovationLoop(workspace, configPath, "status");
      return status.controller_running === true;
    });

    const stopped = await runInnovationLoop(workspace, configPath, "stop");
    expect(stopped.stopped).toBe(true);

    await waitFor(async () => {
      const status = await runInnovationLoop(workspace, configPath, "status");
      return status.controller_running === false;
    });
  }, 15000);

  it("enters review_blocked when all proposal families are cooling down", async () => {
    const { workspace, configPath } = await makeWorkspace();

    await runInnovationLoop(workspace, configPath, "bootstrap");
    await runInnovationLoop(workspace, configPath, "tick");

    const sessionPath = path.join(workspace, "experiments", "session.json");
    const session = JSON.parse(await fs.readFile(sessionPath, "utf8"));
    session.family_cooldowns = {
      "objective.loss": 2,
      "repr.feature": 2,
      "arch.backbone": 2,
    };
    await fs.writeFile(sessionPath, JSON.stringify(session, null, 2) + "\n", "utf8");

    const blocked = await runInnovationLoop(workspace, configPath, "tick");
    expect(blocked.phase).toBe("done");
    expect(blocked.reason).toBe("review_blocked");

    const status = await runInnovationLoop(workspace, configPath, "status");
    expect(status.state).toBe("review_blocked");
    expect(status.stop_reason).toBe("review_blocked");
  }, 15000);
});
