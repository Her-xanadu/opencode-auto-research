import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { slugify } from "../utils/ids";

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

export async function createLineageBranch(workspaceRoot: string, topic: string, runId: string): Promise<string> {
  const branch = `experiment/${slugify(topic)}/${runId}`;
  await git(["branch", branch], workspaceRoot).catch(() => undefined);
  return branch;
}
