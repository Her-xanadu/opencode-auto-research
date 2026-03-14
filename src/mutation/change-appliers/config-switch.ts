import fs from "node:fs/promises";
import path from "node:path";

export async function applyConfigSwitch(executionRoot: string, targetFile: string, search: string, replace: string) {
  const filePath = path.join(executionRoot, targetFile);
  const content = await fs.readFile(filePath, "utf8");
  await fs.writeFile(filePath, content.replace(search, replace), "utf8");
  return { touched_files: [targetFile], diff_summary: `switched config token ${search}` };
}
