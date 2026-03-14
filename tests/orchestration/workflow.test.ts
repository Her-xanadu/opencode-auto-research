import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import loopSpec from "../../fixtures/specs/loop-max-3.json";
import { runGovernedExperimentWorkflow } from "../../src/orchestration/workflow";
import type { ExperimentSpec } from "../../src/spec/schema";
import { readJson, readJsonl, writeJson } from "../../src/utils/fs";
import { getOrchestrationSummaryPath, getOrchestrationTracePath, getRecoveryCheckpointPath, getWorkspaceConfigPath } from "../../src/utils/paths";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-governed-"));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.writeFile(path.join(dir, "src", "config.json"), '{"learning_rate":0.1}\n', "utf8");
  await fs.writeFile(path.join(dir, "src", "strategy.txt"), "baseline\n", "utf8");
  await fs.writeFile(path.join(dir, "src", "module.ts"), "export const variant = 0;\n", "utf8");
  await writeJson(getWorkspaceConfigPath(dir), { ...loopSpec, workspace_root: dir });
  await writeJson(getRecoveryCheckpointPath(dir), {
    run_id: "recoverable-run",
    checkpoint_path: "checkpoints/latest.ckpt",
    parent_run_id: "parent-run",
  });
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("governed experiment workflow", () => {
  it("writes an orchestration trace in specialist order", async () => {
    const workspace = await makeWorkspace();
    const spec: ExperimentSpec = { ...(loopSpec as ExperimentSpec), workspace_root: workspace };
    const result = await runGovernedExperimentWorkflow({ workspaceRoot: workspace, spec });
    const steps = await readJsonl<{ actor: string; status: string; payload?: { execution_mode?: string; raw_excerpt?: string | null } }>(getOrchestrationTracePath(workspace));
    const summary = await readJson<{ specialist_audit?: Array<{ actor: string; session_id: string | null; execution_mode: string | null; fallback_reason: string | null; raw_excerpt: string | null }> }>(getOrchestrationSummaryPath(workspace), {});
    expect(result.total_iterations).toBeGreaterThan(0);
    expect(result.stop_reason).toBeTruthy();
    expect(steps.slice(0, 6).map((step) => step.actor)).toEqual([
      "Apollo",
      "Athena",
      "Hermes",
      "sisyphus-junior",
      "status_poll.py",
      "judge_result.py",
    ]);
    expect(steps.every((step) => typeof step.payload?.execution_mode === "string" || (step.actor === "Sisyphus (Ultraworker)" && step.status === "blocked"))).toBe(true);
    expect(steps.every((step) => step.payload?.execution_mode === "fallback")).toBe(true);
    expect(steps.some((step) => typeof step.payload?.raw_excerpt === "string" || step.payload?.raw_excerpt === null)).toBe(true);
    expect(summary.specialist_audit?.length).toBeGreaterThan(0);
    expect(summary.specialist_audit?.every((entry) => typeof entry.execution_mode === "string" || entry.execution_mode === null)).toBe(true);
    expect(summary.specialist_audit?.some((entry) => entry.raw_excerpt !== null || entry.fallback_reason !== null || entry.session_id !== null)).toBe(true);
  });
});
