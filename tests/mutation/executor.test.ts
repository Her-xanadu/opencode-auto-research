import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeMutation } from "../../src/mutation/executor";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-mutation-"));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.writeFile(path.join(dir, "src", "config.json"), '{"learning_rate":0.1}\n', "utf8");
  await fs.writeFile(path.join(dir, "src", "strategy.txt"), "baseline\n", "utf8");
  await fs.writeFile(path.join(dir, "src", "module.ts"), "export const variant = 0;\n", "utf8");
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("mutation executor", () => {
  it("runs three mutation classes and returns single-primary manifests", async () => {
    const workspace = await makeWorkspace();
    const hyper = await executeMutation(workspace, {
      change_class: "hyperparameter",
      change_unit: "learning_rate",
      target_file: "src/config.json",
      params: { key: "learning_rate", value: 0.2 },
    });
    const config = await executeMutation(workspace, {
      change_class: "config_switch",
      change_unit: "optimizer_schedule",
      target_file: "src/strategy.txt",
      params: { search: "baseline", replace: "cosine" },
    });
    const moduleSwap = await executeMutation(workspace, {
      change_class: "module_swap",
      change_unit: "encoder_module",
      target_file: "src/module.ts",
      params: { content: "export const variant = 3;\n" },
    });
    for (const result of [hyper, config, moduleSwap]) {
      expect(result.change_manifest.primary_object).toBeTruthy();
      expect(result.change_manifest.secondary_objects).toEqual([]);
      expect(result.touched_files.length).toBe(1);
    }
  });
});
