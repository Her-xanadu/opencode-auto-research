import { readJson } from "../utils/fs";
import { getBestPath } from "../utils/paths";

export async function restoreParentState(workspaceRoot: string): Promise<{ restored: boolean; parent_run_id: string | null }> {
  const state = await readJson<{ parent_state?: { run_id: string } | null }>(getBestPath(workspaceRoot), {});
  return {
    restored: Boolean(state.parent_state?.run_id),
    parent_run_id: state.parent_state?.run_id ?? null,
  };
}
