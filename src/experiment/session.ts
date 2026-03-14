import { z } from "zod";
import { syncSessionArtifact } from "../compat/artifacts";
import { readJson, writeJson } from "../utils/fs";
import { createId } from "../utils/ids";
import { getSessionPath } from "../utils/paths";
import { nowIso } from "../utils/time";

export const sessionStageSchema = z.enum([
  "idle",
  "spec_drafting",
  "sandbox_preparing",
  "ready_to_execute",
  "running",
  "monitoring",
  "review_blocked",
  "acceptance_review",
  "completed",
  "crash_recoverable",
]);

export const experimentSessionSchema = z.object({
  session_id: z.string().min(1),
  workspace_root: z.string().min(1),
  stage: sessionStageSchema,
  message: z.string().min(1),
  active_run_id: z.string().nullable(),
  best_run_id: z.string().nullable(),
  stop_reason: z.string().nullable(),
  iteration_count: z.number().int().nonnegative(),
  updated_at: z.string().min(1),
});

export type ExperimentSession = z.infer<typeof experimentSessionSchema>;

export function buildSession(input: {
  workspaceRoot: string;
  stage: ExperimentSession["stage"];
  message: string;
  activeRunId?: string | null;
  bestRunId?: string | null;
  stopReason?: string | null;
  iterationCount?: number;
}): ExperimentSession {
  return experimentSessionSchema.parse({
    session_id: createId("experiment_session"),
    workspace_root: input.workspaceRoot,
    stage: input.stage,
    message: input.message,
    active_run_id: input.activeRunId ?? null,
    best_run_id: input.bestRunId ?? null,
    stop_reason: input.stopReason ?? null,
    iteration_count: input.iterationCount ?? 0,
    updated_at: nowIso(),
  });
}

export async function loadSession(workspaceRoot: string): Promise<ExperimentSession | null> {
  const value = await readJson<unknown | null>(getSessionPath(workspaceRoot), null);
  return value ? experimentSessionSchema.parse(value) : null;
}

export async function saveSession(workspaceRoot: string, session: ExperimentSession): Promise<void> {
  const parsed = experimentSessionSchema.parse(session);
  await writeJson(getSessionPath(workspaceRoot), parsed);
  await syncSessionArtifact(workspaceRoot, parsed);
}
