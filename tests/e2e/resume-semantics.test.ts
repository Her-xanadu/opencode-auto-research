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
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-resume-semantics-"));
  tempDirs.push(workspace);
  await fs.mkdir(path.join(workspace, "configs"), { recursive: true });
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.mkdir(path.join(workspace, "data"), { recursive: true });
  await fs.writeFile(path.join(workspace, "src", "config.json"), JSON.stringify({ objective_mode: "baseline" }, null, 2) + "\n", "utf8");
  await fs.writeFile(path.join(workspace, "src", "strategy.txt"), "baseline\n", "utf8");
  await fs.writeFile(path.join(workspace, "src", "module.ts"), "export const variant = 0;\n", "utf8");
  await fs.writeFile(path.join(workspace, "evaluate.py"), "print(0.8)\n", "utf8");
  await fs.writeFile(path.join(workspace, "configs", "goal.yaml"), ['workspace_root: "."', 'eval_command: "python3 evaluate.py --stage full"', 'eval_parser: "number"', 'primary_metric: "score"', 'metric_direction: "maximize"', 'target_threshold: 0.95'].join("\n") + "\n", "utf8");
  return { workspace, configPath: path.join(workspace, "configs", "goal.yaml") };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })));
});

describe("resume semantics", () => {
  it("resume reuses the failed proposal instead of selecting a fresh one", async () => {
    const { workspace, configPath } = await makeWorkspace();
    const sessionPath = path.join(workspace, "experiments", "session.json");
    await fs.mkdir(path.join(workspace, "experiments", "runs", "failed-run"), { recursive: true });
    await fs.writeFile(sessionPath, JSON.stringify({ session_id: "s1", stage: "crash_recoverable", iteration_count: 1, best_run_id: "round-0001", best_exp_ref: "round-0001", last_failed_task: "failed-run", active_dvc_task: null }, null, 2) + "\n", "utf8");
    await fs.writeFile(path.join(workspace, "experiments", "recovery_checkpoint.json"), JSON.stringify({ run_id: "failed-run", checkpoint_path: "checkpoints/latest.ckpt", parent_run_id: "round-0001" }, null, 2) + "\n", "utf8");
    await fs.writeFile(path.join(workspace, "experiments", "runs", "failed-run", "pending_result.json"), JSON.stringify({ proposal_id: "proposal-failed-1", family: "objective.loss", change_class: "objective", change_unit: "objective-stability-loss-v2", target_file: "src/config.json", files_to_touch: ["src/config.json"], params: { key: "objective_mode", value: "stability_loss_v2" } }, null, 2) + "\n", "utf8");
    const { stdout } = await execFileAsync("python3", [innovationLoopScript, "resume", "--config", configPath, "--workspace", workspace, "--mode", "mock"], { cwd: workspace, env: { ...process.env, CI: "true" } });
    const result = JSON.parse(stdout);
    expect(result.resumed).toBe(true);
    expect(result.mode).toBe("resume");
    const pending = JSON.parse(await fs.readFile(path.join(workspace, "experiments", "runs", result.candidate.run_id, "pending_result.json"), "utf8"));
    expect(pending.proposal_id).toBe("proposal-failed-1");
    expect(pending.family).toBe("objective.loss");
  }, 30000);
});
