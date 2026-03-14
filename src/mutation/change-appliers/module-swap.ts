import fs from "node:fs/promises";
import path from "node:path";

export async function applyModuleSwap(executionRoot: string, targetFile: string, replacement: string) {
  const filePath = path.join(executionRoot, targetFile);
  await fs.writeFile(filePath, replacement, "utf8");
  return { touched_files: [targetFile], diff_summary: `replaced module ${targetFile}` };
}
