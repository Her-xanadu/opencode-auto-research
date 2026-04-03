import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-rollback-"));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.mkdir(path.join(dir, "outputs"), { recursive: true });
  await fs.mkdir(path.join(dir, "experiments", "runs", "rollback-run"), { recursive: true });
  await fs.writeFile(path.join(dir, "src", "config.json"), '{"learning_rate":0.1}\n', "utf8");
  await fs.writeFile(path.join(dir, "src", "deleted.txt"), "keep me\n", "utf8");
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })));
});

describe("rollback side effects", () => {
  it("restores modified, created, deleted, and artifact side effects back to parent state", async () => {
    const workspace = await makeWorkspace();
    await execFileAsync("python3", ["-c", `import pathlib,sys; sys.path.insert(0, ${JSON.stringify(repoRoot + "/scripts")}); from ae_common import save_parent_snapshot, save_run_manifest; ws=pathlib.Path(${JSON.stringify(workspace)}); save_parent_snapshot(ws, 'rollback-run', ['src/config.json','src/new.txt','src/deleted.txt']); save_run_manifest(ws, 'rollback-run', {'touched_files':['src/config.json','src/new.txt','src/deleted.txt'], 'created_files':['src/new.txt'], 'deleted_files':['src/deleted.txt'], 'artifact_files':['outputs/generated.txt']})`], { cwd: repoRoot });
    await fs.writeFile(path.join(workspace, "src", "config.json"), '{"learning_rate":0.9}\n', "utf8");
    await fs.writeFile(path.join(workspace, "src", "new.txt"), "temporary\n", "utf8");
    await fs.rm(path.join(workspace, "src", "deleted.txt"));
    await fs.writeFile(path.join(workspace, "outputs", "generated.txt"), "artifact\n", "utf8");
    await execFileAsync("python3", ["-c", `import pathlib,sys; sys.path.insert(0, ${JSON.stringify(repoRoot + "/scripts")}); from ae_common import restore_parent_snapshot; restore_parent_snapshot(pathlib.Path(${JSON.stringify(workspace)}), 'rollback-run')`], { cwd: repoRoot });
    expect(await fs.readFile(path.join(workspace, "src", "config.json"), "utf8")).toContain('0.1');
    await expect(fs.stat(path.join(workspace, "src", "new.txt"))).rejects.toThrow();
    expect(await fs.readFile(path.join(workspace, "src", "deleted.txt"), "utf8")).toContain("keep me");
    await expect(fs.stat(path.join(workspace, "outputs", "generated.txt"))).rejects.toThrow();
  }, 15000);
});
