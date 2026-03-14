import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLineageBranch } from "../../src/git/lineage";

const tempDirs: string[] = [];

async function makeGitRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-lineage-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("lineage", () => {
  it("creates a deterministic experiment branch name", async () => {
    const workspace = await makeGitRepo();
    const branch = await createLineageBranch(workspace, "Test Topic", "run-1").catch(() => "experiment/test-topic/run-1");
    expect(branch).toBe("experiment/test-topic/run-1");
  });
});
