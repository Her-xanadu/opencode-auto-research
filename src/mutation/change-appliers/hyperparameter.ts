import fs from "node:fs/promises";
import path from "node:path";

export async function applyHyperparameterChange(executionRoot: string, targetFile: string, key: string, value: unknown) {
  const filePath = path.join(executionRoot, targetFile);
  const json = JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
  json[key] = value;
  await fs.writeFile(filePath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
  return { touched_files: [targetFile], diff_summary: `updated hyperparameter ${key}` };
}
