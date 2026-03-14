import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const tempDirs: string[] = [];

export async function makeKbWorkspace(): Promise<{ workspace: string; vaultRoot: string }> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-kb-"));
  tempDirs.push(workspace);
  await fs.mkdir(path.join(workspace, "configs"), { recursive: true });
  await fs.mkdir(path.join(workspace, "experiments"), { recursive: true });
  const vaultRoot = path.join(workspace, "vault");
  await fs.cp(path.join(repoRoot, "fixtures", "kb", "vault"), vaultRoot, { recursive: true });
  await fs.writeFile(
    path.join(workspace, "configs", "research_brain.yaml"),
    [
      `vault_root: ${vaultRoot}`,
      "index_output_dir: experiments/research/index",
      "retrieval_cache_dir: experiments/research/retrieval-cache",
      "evidence_output_dir: experiments/research",
      "feedback_output: experiments/research/paper-feedback.jsonl",
      "posterior_rank_output: experiments/research/posterior-rank.json",
      "paper_id_map_output: experiments/research/paper-id-map.jsonl",
      "frontier_map_output: experiments/research/index/frontier-map.json",
    ].join("\n") + "\n",
    "utf8",
  );
  return { workspace, vaultRoot };
}

export async function runPython(scriptRelativePath: string, args: string[], cwd: string): Promise<any> {
  const { stdout } = await execFileAsync("python3", [path.join(repoRoot, scriptRelativePath), ...args], { cwd });
  return JSON.parse(stdout);
}
