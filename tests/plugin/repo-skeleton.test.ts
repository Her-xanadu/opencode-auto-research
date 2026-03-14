import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("repo skeleton", () => {
  it("contains the planned AGENTS and experiments skeleton files", async () => {
    const requiredPaths = [
      "AGENTS.md",
      "experiments/session.json",
      "experiments/best.json",
      "experiments/attempts.jsonl",
      "experiments/proposals/.gitkeep",
      "experiments/runs/.gitkeep",
    ];

    await Promise.all(
      requiredPaths.map(async (relativePath) => {
        const stat = await fs.stat(path.join(repoRoot, relativePath));
        expect(stat).toBeTruthy();
      }),
    );
  });
});
