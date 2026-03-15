import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const repoRoot = "/Users/herxanadu/Desktop/opencode-auto-experiment";

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-remote-contract-"));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, "experiments", "checkpoints"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "remote_eval.py"),
    [
      "import argparse, json, pathlib",
      "p=argparse.ArgumentParser()",
      "p.add_argument('--resume-from')",
      "args=p.parse_args()",
      "ckpt = pathlib.Path('experiments/checkpoints/remote.ckpt')",
      "ckpt.write_text('checkpoint\\n', encoding='utf-8')",
      "metrics = pathlib.Path('experiments/metrics.json')",
      "metrics.write_text(json.dumps({'score': 0.91, 'resume_from': args.resume_from}, indent=2) + '\\n', encoding='utf-8')",
      "print(0.91)",
    ].join("\n") + "\n",
    "utf8",
  );
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })));
});

describe("remote execution contract", () => {
  it("validates that a mock remote adapter preserves metrics, checkpoint, and resume semantics", async () => {
    const workspace = await makeWorkspace();
    await execFileAsync("python3", ["remote_eval.py"], { cwd: workspace });
    const firstMetrics = JSON.parse(await fs.readFile(path.join(workspace, "experiments", "metrics.json"), "utf8"));
    expect(firstMetrics.score).toBe(0.91);
    expect(firstMetrics.resume_from).toBeNull();
    await expect(fs.stat(path.join(workspace, "experiments", "checkpoints", "remote.ckpt"))).resolves.toBeTruthy();
    await execFileAsync("python3", ["remote_eval.py", "--resume-from", "experiments/checkpoints/remote.ckpt"], { cwd: workspace });
    const resumedMetrics = JSON.parse(await fs.readFile(path.join(workspace, "experiments", "metrics.json"), "utf8"));
    expect(resumedMetrics.resume_from).toContain("remote.ckpt");
  }, 15000);
});
