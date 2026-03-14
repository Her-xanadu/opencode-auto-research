import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type PythonControllerCommand =
  | "bootstrap"
  | "start"
  | "tick"
  | "status"
  | "resume"
  | "stop";

export interface PythonControllerOptions {
  workspaceRoot: string;
  configPath?: string;
  detached?: boolean;
  mode?: "mock" | "live";
  pollInterval?: number;
  env?: NodeJS.ProcessEnv;
}

export async function runPythonControllerCommand(
  command: PythonControllerCommand,
  options: PythonControllerOptions,
): Promise<unknown> {
  const scriptPath = path.resolve(process.cwd(), "scripts", "innovation_loop.py");
  const args = [
    scriptPath,
    command,
    "--config",
    options.configPath ?? path.join(options.workspaceRoot, "configs", "goal.yaml"),
    "--workspace",
    options.workspaceRoot,
  ];

  if (command === "start" && options.detached) {
    args.push("--detached");
  }
  if (options.mode) {
    args.push("--mode", options.mode);
  }
  if (command === "start" && typeof options.pollInterval === "number") {
    args.push("--poll-interval", String(options.pollInterval));
  }

  const { stdout } = await execFileAsync("python3", args, {
    cwd: process.cwd(),
    env: { ...process.env, ...options.env },
  });
  return JSON.parse(stdout);
}
