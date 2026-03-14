import { sandboxPreparationSchema, type SandboxPreparationInput } from "./schema";

function matchesGlob(filePath: string, pattern: string): boolean {
  if (pattern.endsWith("/**")) {
    return filePath === pattern.slice(0, -3) || filePath.startsWith(pattern.slice(0, -2));
  }
  return filePath === pattern;
}

function matchesAny(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesGlob(filePath, pattern));
}

export interface DockerSandboxResult {
  valid: boolean;
  status: "ready" | "sandbox_violation";
  message: string;
}

export function prepareDockerSandbox(input: SandboxPreparationInput): DockerSandboxResult {
  const parsed = sandboxPreparationSchema.parse(input);
  const target = parsed.sample_write_path;
  if (target) {
    if (matchesAny(target, parsed.read_only_paths) || !matchesAny(target, parsed.editable_paths)) {
      return {
        valid: false,
        status: "sandbox_violation",
        message: `write blocked for ${target}`,
      };
    }
  }
  return {
    valid: true,
    status: "ready",
    message: "docker sandbox preflight passed",
  };
}
