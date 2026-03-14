import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runEvalCommand(command: string, cwd: string, parser: string): Promise<number> {
  const { stdout } = await execFileAsync("bash", ["-lc", command], { cwd });
  const trimmed = stdout.trim();
  if (parser === "json") {
    return Number((JSON.parse(trimmed) as { metric: number }).metric);
  }
  return Number(trimmed);
}
