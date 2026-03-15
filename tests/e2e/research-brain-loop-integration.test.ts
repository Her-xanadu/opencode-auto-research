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
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-research-brain-loop-"));
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

async function runInnovationLoop(workspace: string, configPath: string, command: string): Promise<any> {
  const { stdout } = await execFileAsync("python3", [innovationLoopScript, command, "--config", configPath, "--workspace", workspace, "--mode", "mock"], { cwd: workspace });
  return JSON.parse(stdout);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("research brain loop integration", () => {
  it("injects evidence pack and paper grounding before candidate execution", async () => {
    const { workspace, configPath } = await makeWorkspace();
    await runInnovationLoop(workspace, configPath, "bootstrap");
    await runInnovationLoop(workspace, configPath, "tick");
    const candidate = await runInnovationLoop(workspace, configPath, "tick");
    expect(candidate.phase).toBe("candidate");
    expect(candidate.research_context.evidence_pack_path).toContain("evidence-round-0001.md");
    const evidence = await fs.readFile(path.join(workspace, "experiments", "research", "evidence-round-0001.md"), "utf8");
    expect(evidence).toContain("推荐论文 1（高度相关）");
    expect(evidence).toContain("创新综合脊柱");
    const proposals = JSON.parse(await fs.readFile(path.join(workspace, "experiments", "proposals", "round-0001.json"), "utf8"));
    expect(proposals.next_primary_hypothesis.paper_grounding).toHaveLength(2);
    expect(proposals.next_primary_hypothesis.paper_grounding[0].mechanism_transfer).toBeTruthy();
    expect(proposals.next_primary_hypothesis.redirect_if_underperforming).toBeTruthy();
    expect(proposals.next_primary_hypothesis.causal_metric_path).toBeTruthy();
    expect(proposals.next_primary_hypothesis.failure_signature).toBeTruthy();
    expect(proposals.next_primary_hypothesis.pivot_after_failure).toBeTruthy();
  }, 15000);
});
