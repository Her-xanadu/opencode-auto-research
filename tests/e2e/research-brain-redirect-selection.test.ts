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

async function makeWorkspace(): Promise<{ workspace: string; configPath: string; fakeBin: string }> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-research-brain-redirect-"));
  tempDirs.push(workspace);
  await fs.mkdir(path.join(workspace, "configs"), { recursive: true });
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.mkdir(path.join(workspace, "data"), { recursive: true });
  await fs.mkdir(path.join(workspace, "experiments"), { recursive: true });
  await fs.cp(path.join(repoRoot, "fixtures", "kb", "vault"), path.join(workspace, "vault"), { recursive: true });
  const fakeBin = path.join(workspace, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
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
  await fs.writeFile(
    path.join(fakeBin, "opencode"),
    `#!/usr/bin/env python3
import json, sys
args = sys.argv[1:]
prompt = args[-1] if args else ""
agent = args[args.index("--agent") + 1] if "--agent" in args else None
if agent is None:
    if "@Apollo" in prompt:
        agent = "Apollo"
    elif "@Athena" in prompt:
        agent = "Athena"
    elif "@Hermes" in prompt:
        agent = "Hermes"
    elif "@sisyphus-junior" in prompt:
        agent = "sisyphus-junior"
if agent == "Apollo":
    print(json.dumps({"choice":"objective","title":"repeat-objective","family":"objective.loss","innovation_tags":["objective"],"mechanism":"对目标函数做正则化，预期先改善中间稳定性指标，再影响目标指标。","files_to_touch":["src/config.json"],"expected_gain":0.02,"risk":"low","why_not_parameter_only":"changes objective family","minimal_ablation":["revert objective"],"paper_grounding":[{"paper_id":"doi:10.1145/3718958.3750493","why_relevant":"exploit","mechanism_transfer":"online update"},{"paper_id":"doi:10.1145/3711896.3736964","why_relevant":"ood","mechanism_transfer":"ood gating"}],"redirect_if_underperforming":"停止重复 objective.loss，转向 repr.feature"}))
elif agent == "Hermes":
    print(json.dumps({"choice":"representation","title":"orthogonal-repr","family":"repr.feature","innovation_tags":["representation"],"mechanism":"对表征层做重塑，预期先改变表征判别性，再影响目标指标。","files_to_touch":["src/strategy.txt"],"expected_gain":0.01,"risk":"medium","why_not_parameter_only":"changes representation path","minimal_ablation":["revert strategy"],"paper_grounding":[{"paper_id":"doi:10.1145/3711896.3736964","why_relevant":"support","mechanism_transfer":"semantic prompt"},{"paper_id":"paper:arxiv:2024:ffffeeee11","why_relevant":"orthogonal","mechanism_transfer":"test-time training"}],"redirect_if_underperforming":"停止重复 repr.feature，转向 arch.backbone"}))
elif agent == "Athena":
    print(json.dumps({"verdict":"approve","validity_risks":[],"smallest_repair":None,"single_change_ok":True,"paper_support_ok":True,"redirect_if_underperforming":"若继续不达标，停止重复 objective.loss，转向 repr.feature"}))
elif agent == "sisyphus-junior":
    print(json.dumps({"touched_files":["src/strategy.txt"],"diff_summary":"redirected change","change_manifest":{"primary_object":"representation","secondary_objects":[]}}))
else:
    print(json.dumps({"ok": True}))
`,
    "utf8",
  );
  await fs.chmod(path.join(fakeBin, "opencode"), 0o755);
  return { workspace, configPath: path.join(workspace, "configs", "goal.yaml"), fakeBin };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("research brain redirect selection", () => {
  it("pivots to Hermes when the same family underperformed last round", async () => {
    const { workspace, configPath, fakeBin } = await makeWorkspace();
    const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}`, INNOVATION_LOOP_OPENCODE_DIR: repoRoot, INNOVATION_LOOP_AGENT_MODEL: "kimi-for-coding/kimi-k2.5", INNOVATION_LOOP_DISABLE_REAL_DVC: "1" };
    await execFileAsync("python3", [innovationLoopScript, "bootstrap", "--config", configPath, "--workspace", workspace, "--mode", "live"], { cwd: workspace, env });
    await execFileAsync("python3", [innovationLoopScript, "tick", "--config", configPath, "--workspace", workspace, "--mode", "live"], { cwd: workspace, env });
    const attemptsPath = path.join(workspace, "experiments", "attempts.jsonl");
    await fs.writeFile(attemptsPath, JSON.stringify({ family: "objective.loss", decision: "discard", redirect_if_underperforming: "停止重复 objective.loss，转向 repr.feature" }) + "\n", "utf8");
    await execFileAsync("python3", [innovationLoopScript, "tick", "--config", configPath, "--workspace", workspace, "--mode", "live"], { cwd: workspace, env });
    const proposals = JSON.parse(await fs.readFile(path.join(workspace, "experiments", "proposals", "round-0001.json"), "utf8"));
    expect(proposals.next_primary_hypothesis.family).toBe("repr.feature");
    expect(proposals.reject_reasons.controller_redirect).toContain("停止重复 objective.loss");
  }, 15000);
});
