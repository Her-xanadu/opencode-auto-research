import type { infer as ZodInfer } from "zod";
import { controllerSessionSchema } from "../controller/schema";
import { readJson, writeJson } from "../utils/fs";
import { createId } from "../utils/ids";
import { getSessionPath } from "../utils/paths";
import { nowIso } from "../utils/time";

export const experimentSessionSchema = controllerSessionSchema;
export const sessionStageSchema = controllerSessionSchema.shape.stage;

export type ExperimentSession = ZodInfer<typeof experimentSessionSchema>;

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
}
