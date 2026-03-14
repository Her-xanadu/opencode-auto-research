import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function run(command: string, args: string[]) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, CI: "true" },
  });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

async function main() {
  await run("docker", ["compose", "build", "app"]);
  await run("docker", ["compose", "run", "--rm", "app", "npm", "run", "typecheck"]);
  await run("docker", ["compose", "run", "--rm", "app", "npm", "test"]);
  await run("docker", ["compose", "run", "--rm", "app", "npm", "run", "test:smoke"]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
