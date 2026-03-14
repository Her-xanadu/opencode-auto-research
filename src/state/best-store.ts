import { z } from "zod";
import { syncBestArtifact } from "../compat/artifacts";
import { readJson, writeJson } from "../utils/fs";
import { getBestPath } from "../utils/paths";
import { nowIso } from "../utils/time";

export const bestStoreSchema = z.object({
  current_best: z
    .object({
      run_id: z.string(),
      metric: z.number(),
      commit: z.string(),
      checkpoint: z.string().nullable(),
    })
    .nullable(),
  candidate: z
    .object({
      run_id: z.string(),
      metric: z.number(),
      commit: z.string(),
      checkpoint: z.string().nullable(),
    })
    .nullable(),
  parent_state: z
    .object({
      run_id: z.string(),
      commit: z.string(),
    })
    .nullable(),
  updated_at: z.string(),
});

export type BestStore = z.infer<typeof bestStoreSchema>;

function emptyBest(): BestStore {
  return {
    current_best: null,
    candidate: null,
    parent_state: null,
    updated_at: nowIso(),
  };
}

export class BestStoreManager {
  constructor(private readonly workspaceRoot: string) {}

  async load(): Promise<BestStore> {
    const value = await readJson<unknown | null>(getBestPath(this.workspaceRoot), null);
    return value ? bestStoreSchema.parse(value) : emptyBest();
  }

  async save(value: BestStore): Promise<BestStore> {
    const parsed = bestStoreSchema.parse({ ...value, updated_at: nowIso() });
    await writeJson(getBestPath(this.workspaceRoot), parsed);
    await syncBestArtifact(this.workspaceRoot, parsed);
    return parsed;
  }
}
