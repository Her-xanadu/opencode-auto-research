import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  experiment_controller_bootstrap,
  experiment_controller_start,
  experiment_controller_status,
  experiment_controller_tick,
} from "../../src/tools";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-controller-tools-"));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.mkdir(path.join(dir, "data"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "src", "config.json"),
    JSON.stringify({ learning_rate: 0.2, dropout: 0.1, objective_mode: "baseline" }, null, 2) + "\n",
    "utf8",
  );
  await fs.writeFile(path.join(dir, "src", "strategy.txt"), "baseline\n", "utf8");
  await fs.writeFile(path.join(dir, "src", "module.ts"), "export const variant = 0;\n", "utf8");
  await fs.writeFile(path.join(dir, "data", "observations.csv"), "split,value\ntrain,1\nvalid,1\n", "utf8");
  await fs.writeFile(
    path.join(dir, "evaluate.py"),
    [
      "import argparse",
      "import json",
      "import pathlib",
      "parser = argparse.ArgumentParser()",
      "parser.add_argument('--stage', default='baseline')",
      "parser.add_argument('--resume-from')",
      "args = parser.parse_args()",
      "pathlib.Path('experiments').mkdir(parents=True, exist_ok=True)",
      "score = 0.75 if args.stage == 'baseline' else 0.88",
      "pathlib.Path('experiments/metrics.json').write_text(json.dumps({'score': score, 'stage': args.stage, 'resume_from': args.resume_from}, indent=2) + '\\n')",
      "pathlib.Path('experiments/checkpoints').mkdir(parents=True, exist_ok=True)",
      "pathlib.Path('experiments/checkpoints/last.ckpt').write_text('checkpoint\\n')",
      "print(score)",
    ].join("\n"),
    "utf8",
  );
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("python controller tools", () => {
  it("bootstraps and ticks the Python controller through TS tool wrappers", async () => {
    const workspaceRoot = await makeWorkspace();

    const bootstrap = JSON.parse(
      await experiment_controller_bootstrap.execute({ workspace_root: workspaceRoot, mode: "mock" }),
    );
    expect(bootstrap.unresolved_fields).toEqual([]);

    const baseline = JSON.parse(
      await experiment_controller_tick.execute({ workspace_root: workspaceRoot, mode: "mock" }),
    );
    expect(baseline.phase).toBe("baseline");

    const started = JSON.parse(
      await experiment_controller_start.execute({ workspace_root: workspaceRoot, mode: "mock", detached: false }),
    );
    expect(["candidate", "candidate_rejected", "poll", "judge", "done"]).toContain(started.phase);

    const status = JSON.parse(
      await experiment_controller_status.execute({ workspace_root: workspaceRoot, mode: "mock" }),
    );
    expect(status.loop_id).toBeTruthy();
    expect(status.controller_not_running).toBe(true);
  }, 15000);
});
