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
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-specialist-fail-"));
  tempDirs.push(workspace);
  await fs.mkdir(path.join(workspace, "configs"), { recursive: true });
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.mkdir(path.join(workspace, "data"), { recursive: true });
  await fs.cp(path.join(repoRoot, "fixtures", "kb", "vault"), path.join(workspace, "vault"), { recursive: true });
  const fakeBin = path.join(workspace, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(workspace, "src", "config.json"), JSON.stringify({ objective_mode: "baseline" }, null, 2) + "\n", "utf8");
  await fs.writeFile(path.join(workspace, "src", "strategy.txt"), "baseline\n", "utf8");
  await fs.writeFile(path.join(workspace, "src", "module.ts"), "export const variant = 0;\n", "utf8");
  await fs.writeFile(path.join(workspace, "data", "observations.csv"), "split,value\ntrain,1\n", "utf8");
  await fs.writeFile(path.join(workspace, "evaluate.py"), "print(0.8)\n", "utf8");
  await fs.writeFile(path.join(workspace, "configs", "research_brain.yaml"), [`vault_root: ${path.join(workspace, "vault")}`, "index_output_dir: experiments/research/index", "retrieval_cache_dir: experiments/research/retrieval-cache", "evidence_output_dir: experiments/research", "feedback_output: experiments/research/paper-feedback.jsonl", "posterior_rank_output: experiments/research/posterior-rank.json", "paper_id_map_output: experiments/research/paper-id-map.jsonl", "frontier_map_output: experiments/research/index/frontier-map.json"].join("\n") + "\n", "utf8");
  await fs.writeFile(path.join(fakeBin, "opencode"), `#!/usr/bin/env python3
import sys
args = sys.argv[1:]
prompt = args[-1] if args else ""
agent = args[args.index("--agent") + 1] if "--agent" in args else None
if agent is None and "@Apollo" in prompt:
    agent = "Apollo"
if agent == "Apollo":
    print("not-json-response")
else:
    print('{"ok": true}')
`, "utf8");
  await fs.chmod(path.join(fakeBin, "opencode"), 0o755);
  await fs.writeFile(path.join(workspace, "configs", "goal.yaml"), ['goal_text: "test"', 'target_metric: "score"', 'metric_direction: "maximize"'].join("\n") + "\n", "utf8");
  return { workspace, configPath: path.join(workspace, "configs", "goal.yaml"), fakeBin };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })));
});

describe("specialist schema failure", () => {
  it("fails loudly when a live specialist returns invalid JSON", async () => {
    const { workspace, configPath, fakeBin } = await makeWorkspace();
    const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}`, INNOVATION_LOOP_OPENCODE_DIR: repoRoot, INNOVATION_LOOP_AGENT_MODEL: "kimi-for-coding/kimi-k2.5", INNOVATION_LOOP_DISABLE_REAL_DVC: "1" };
    await execFileAsync("python3", [innovationLoopScript, "bootstrap", "--config", configPath, "--workspace", workspace, "--mode", "live"], { cwd: workspace, env });
    await execFileAsync("python3", [innovationLoopScript, "tick", "--config", configPath, "--workspace", workspace, "--mode", "live"], { cwd: workspace, env });
    await expect(execFileAsync("python3", [innovationLoopScript, "tick", "--config", configPath, "--workspace", workspace, "--mode", "live"], { cwd: workspace, env })).rejects.toThrow();
    const failureDir = path.join(workspace, "experiments", "live-specialist-failures");
    const files = await fs.readdir(failureDir);
    expect(files.length).toBeGreaterThan(0);
  }, 15000);
});
