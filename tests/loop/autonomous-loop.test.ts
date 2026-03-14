import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import loopSpec from "../../fixtures/specs/loop-max-3.json";
import { runAutonomousLoop } from "../../src/loop/autonomous-loop";
import { writeJson } from "../../src/utils/fs";
import { getWorkspaceConfigPath } from "../../src/utils/paths";
import type { ExperimentSpec } from "../../src/spec/schema";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-auto-loop-"));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.writeFile(path.join(dir, "src", "config.json"), '{"learning_rate":0.1}\n', "utf8");
  await fs.writeFile(path.join(dir, "src", "strategy.txt"), "baseline\n", "utf8");
  await fs.writeFile(path.join(dir, "src", "module.ts"), "export const variant = 0;\n", "utf8");
  await writeJson(getWorkspaceConfigPath(dir), { ...loopSpec, workspace_root: dir });
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("autonomous loop", () => {
  it("runs until stop_rule, budget, or review block", async () => {
    const workspace = await makeWorkspace();
    const spec: ExperimentSpec = { ...(loopSpec as ExperimentSpec), workspace_root: workspace };
    const result = await runAutonomousLoop({
      workspaceRoot: workspace,
      spec,
      mutationFactory: (iteration) => ({
        change_class: iteration === 1 ? "hyperparameter" : iteration === 2 ? "config_switch" : "module_swap",
        change_unit: `iter_${iteration}`,
        target_file: iteration === 1 ? "src/config.json" : iteration === 2 ? "src/strategy.txt" : "src/module.ts",
        params: iteration === 1 ? { key: "learning_rate", value: 0.8 } : iteration === 2 ? { search: "baseline", replace: "variant" } : { content: "export const variant = 5;\n" },
      }),
    });
    expect(result.runs.length).toBeGreaterThan(0);
    expect(["goal_reached", "budget_exhausted", "review_blocked", "stop_rule_triggered"]).toContain(result.stop_reason);
  });
});
