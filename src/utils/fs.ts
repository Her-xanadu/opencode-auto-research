import fs from "node:fs/promises";
import path from "node:path";

async function ensureParent(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await ensureParent(filePath);
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function appendJsonl(filePath: string, value: unknown): Promise<void> {
  await ensureParent(filePath);
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

export async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

export async function readText(filePath: string, fallback = ""): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

export async function writeText(filePath: string, value: string): Promise<void> {
  await ensureParent(filePath);
  await fs.writeFile(filePath, value, "utf8");
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
