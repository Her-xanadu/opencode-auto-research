import { execFile } from "node:child_process";
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

async function makeWorkspace(): Promise<{ workspace: string; configPath: string }> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-direction-memory-"));
  tempDirs.push(workspace);
  await fs.mkdir(path.join(workspace, "configs"), { recursive: true });
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.mkdir(path.join(workspace, "data"), { recursive: true });
  await fs.cp(path.join(repoRoot, "fixtures", "kb", "vault"), path.join(workspace, "vault"), { recursive: true });
  await fs.writeFile(path.join(workspace, "src", "config.json"), JSON.stringify({ objective_mode: "baseline" }, null, 2) + "\n", "utf8");
  await fs.writeFile(path.join(workspace, "src", "strategy.txt"), "baseline\n", "utf8");
  await fs.writeFile(path.join(workspace, "src", "module.ts"), "export const variant = 0;\n", "utf8");
  await fs.writeFile(path.join(workspace, "data", "observations.csv"), "split,value\ntrain,1\n", "utf8");
  await fs.writeFile(path.join(workspace, "evaluate.py"), "print(0.8)\n", "utf8");
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

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("research brain direction memory", () => {
  it("uses session-level direction_memory even without fresh attempts rows", async () => {
    const { workspace, configPath } = await makeWorkspace();
    await execFileAsync("python3", [innovationLoopScript, "bootstrap", "--config", configPath, "--workspace", workspace, "--mode", "mock"], { cwd: workspace });
    const sessionPath = path.join(workspace, "experiments", "session.json");
    const session = JSON.parse(await fs.readFile(sessionPath, "utf8"));
    session.direction_memory = {
      "objective.loss": {
        next_family: "repr.feature",
        reason: "停止重复 objective.loss，转向 repr.feature",
        updated_at: "2026-03-14T00:00:00Z",
      },
    };
    session.direction_memory_v2 = {
      "objective.loss|generic-underperform|loss_shape->optimization_stability->target_metric": {
        "repr.feature": {
          weight: 1.5,
          last_round: 1,
          reason: "停止重复 objective.loss，转向 repr.feature",
          metric_path_signature: "loss_shape->optimization_stability->target_metric",
          failure_signature: "loss path stalled",
          failure_type: "causal_path_failure",
          success_count: 2,
          failure_count: 1,
          crash_count: 0,
          confidence: 0.67,
        },
        "arch.backbone": {
          weight: 1.8,
          last_round: 1,
          reason: "停止重复 objective.loss，转向 arch.backbone",
          metric_path_signature: "loss_shape->optimization_stability->target_metric",
          failure_signature: "loss path stalled",
          failure_type: "causal_path_failure",
          success_count: 0,
          failure_count: 3,
          crash_count: 1,
          confidence: 0.0,
        },
      },
    };
    await fs.writeFile(sessionPath, JSON.stringify(session, null, 2) + "\n", "utf8");
    await execFileAsync("python3", [innovationLoopScript, "tick", "--config", configPath, "--workspace", workspace, "--mode", "mock"], { cwd: workspace });
    await execFileAsync("python3", [innovationLoopScript, "tick", "--config", configPath, "--workspace", workspace, "--mode", "mock"], { cwd: workspace });
    const proposals = JSON.parse(await fs.readFile(path.join(workspace, "experiments", "proposals", "round-0001.json"), "utf8"));
    expect(proposals.next_primary_hypothesis.family).toBe("repr.feature");
    const savedSession = JSON.parse(await fs.readFile(sessionPath, "utf8"));
    expect(savedSession.direction_memory_v2["objective.loss|generic-underperform|loss_shape->optimization_stability->target_metric"]["repr.feature"].failure_type).toBe("causal_path_failure");
  }, 15000);
});
