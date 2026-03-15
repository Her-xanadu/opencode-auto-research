import path from "node:path";
import { readJson, writeJson } from "../utils/fs";
import { getRecoveryCheckpointPath } from "../utils/paths";

export interface RecoveryCheckpoint {
  run_id: string;
  checkpoint_path: string | null;
  parent_run_id: string | null;
}

export async function saveRecoveryCheckpoint(workspaceRoot: string, checkpoint: RecoveryCheckpoint): Promise<void> {
  await writeJson(getRecoveryCheckpointPath(workspaceRoot), checkpoint);
}

export async function resumeExperiment(workspaceRoot: string): Promise<{ resumed: boolean; source: string | null }> {
  let checkpoint = await readJson<RecoveryCheckpoint | null>(getRecoveryCheckpointPath(workspaceRoot), null);
  if (!checkpoint) {
    checkpoint = await readJson<RecoveryCheckpoint | null>(path.join(workspaceRoot, ".opencode", "auto-experiment", "recovery-checkpoint.json"), null);
  }
  if (!checkpoint) {
    return { resumed: false, source: null };
  }
  if (checkpoint.checkpoint_path) {
    return { resumed: true, source: checkpoint.checkpoint_path };
  }
  if (checkpoint.parent_run_id) {
    return { resumed: true, source: checkpoint.parent_run_id };
  }
  return { resumed: false, source: null };
}
