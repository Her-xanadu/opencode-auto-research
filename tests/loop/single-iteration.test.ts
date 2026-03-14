import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeIteration } from "../../src/loop/execute-iteration";
import { readJsonl, writeJson } from "../../src/utils/fs";
import { getWorkspaceConfigPath, getRunsPath } from "../../src/utils/paths";
import validSpec from "../../fixtures/specs/valid-spec.json";
import type { ExperimentSpec } from "../../src/spec/schema";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-loop-"));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.writeFile(path.join(dir, "src", "config.json"), '{"learning_rate":0.1}\n', "utf8");
  await fs.writeFile(path.join(dir, "src", "strategy.txt"), "baseline\n", "utf8");
  await fs.writeFile(path.join(dir, "src", "module.ts"), "export const variant = 0;\n", "utf8");
  await writeJson(getWorkspaceConfigPath(dir), { ...validSpec, workspace_root: dir });
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("single experiment iteration", () => {
  it("runs baseline -> mutate -> eval -> decide -> record", async () => {
    const workspace = await makeWorkspace();
    const spec: ExperimentSpec = { ...(validSpec as ExperimentSpec), workspace_root: workspace };
    const result = await executeIteration({
      workspaceRoot: workspace,
      spec,
      mutation: {
        change_class: "hyperparameter",
        change_unit: "learning_rate",
        target_file: "src/config.json",
        params: { key: "learning_rate", value: 0.9 },
      },
      baselineMetric: 0.5,
    });
    const runs = await readJsonl(getRunsPath(workspace));
    expect(result.run_id).toBeTruthy();
    expect(runs).toHaveLength(1);
    expect((runs[0] as { status: string }).status).toBe("keep");
  });
});
