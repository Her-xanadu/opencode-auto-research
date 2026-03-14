import { appendJsonl, readJsonl } from "../utils/fs";
import { createId } from "../utils/ids";
import { getRecoveryJournalPath } from "../utils/paths";
import { nowIso } from "../utils/time";

export interface RecoveryEntry {
  event_id: string;
  run_id: string;
  stage: string;
  status: string;
  created_at: string;
}

export async function appendRecoveryEntry(workspaceRoot: string, runId: string, stage: string, status: string): Promise<RecoveryEntry> {
  const entry = {
    event_id: createId("recovery_event"),
    run_id: runId,
    stage,
    status,
    created_at: nowIso(),
  };
  await appendJsonl(getRecoveryJournalPath(workspaceRoot), entry);
  return entry;
}

export async function listRecoveryEntries(workspaceRoot: string): Promise<RecoveryEntry[]> {
  return readJsonl<RecoveryEntry>(getRecoveryJournalPath(workspaceRoot));
}
