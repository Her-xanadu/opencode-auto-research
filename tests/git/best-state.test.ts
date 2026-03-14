import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BestStoreManager } from "../../src/state/best-store";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-best-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("best store", () => {
  it("persists keep, candidate, and parent state transitions", async () => {
    const workspace = await makeWorkspace();
    const store = new BestStoreManager(workspace);
    await store.save({
      current_best: { run_id: "run-1", metric: 0.9, commit: "abc", checkpoint: null },
      candidate: { run_id: "run-2", metric: 0.8, commit: "def", checkpoint: null },
      parent_state: { run_id: "run-1", commit: "abc" },
      updated_at: new Date().toISOString(),
    });
    const loaded = await store.load();
    expect(loaded.current_best?.run_id).toBe("run-1");
    expect(loaded.candidate?.run_id).toBe("run-2");
  });
});
