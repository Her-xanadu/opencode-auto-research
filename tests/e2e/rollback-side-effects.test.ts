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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-rollback-"));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.mkdir(path.join(dir, "experiments", "runs", "rollback-run"), { recursive: true });
  await fs.writeFile(path.join(dir, "src", "config.json"), '{"learning_rate":0.1}\n', "utf8");
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })));
});

describe("rollback side effects", () => {
  it("restores modified files and removes files created after the snapshot", async () => {
    const workspace = await makeWorkspace();
    await execFileAsync("python3", ["-c", `import pathlib,sys; sys.path.insert(0, ${JSON.stringify(repoRoot + "/scripts")}); from ae_common import save_parent_snapshot; save_parent_snapshot(pathlib.Path(${JSON.stringify(workspace)}), 'rollback-run', ['src/config.json','src/new.txt'])`], { cwd: repoRoot });
    await fs.writeFile(path.join(workspace, "src", "config.json"), '{"learning_rate":0.9}\n', "utf8");
    await fs.writeFile(path.join(workspace, "src", "new.txt"), "temporary\n", "utf8");
    await execFileAsync("python3", ["-c", `import pathlib,sys; sys.path.insert(0, ${JSON.stringify(repoRoot + "/scripts")}); from ae_common import restore_parent_snapshot; restore_parent_snapshot(pathlib.Path(${JSON.stringify(workspace)}), 'rollback-run')`], { cwd: repoRoot });
    expect(await fs.readFile(path.join(workspace, "src", "config.json"), "utf8")).toContain('0.1');
    await expect(fs.stat(path.join(workspace, "src", "new.txt"))).rejects.toThrow();
  }, 15000);
});
