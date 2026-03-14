import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeKbWorkspace, repoRoot, runPython, tempDirs } from "./test-helpers";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("kb paper feedback", () => {
  it("appends keep and discard feedback rows", async () => {
    const { workspace } = await makeKbWorkspace();
    const outputPath = path.join(workspace, "experiments", "research", "paper-feedback.jsonl");
    await runPython("scripts/kb/update_paper_feedback.py", ["--input", path.join(repoRoot, "fixtures", "kb", "feedback", "keep.json"), "--output", outputPath], workspace);
    await runPython("scripts/kb/update_paper_feedback.py", ["--input", path.join(repoRoot, "fixtures", "kb", "feedback", "discard.json"), "--output", outputPath], workspace);
    const rows = (await fs.readFile(outputPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.round).toBeTypeOf("number");
      expect(row.paper_id).toBeTruthy();
      expect(row.proposal_family).toBeTruthy();
      expect(["keep", "discard"]).toContain(row.decision);
      expect(typeof row.metric_gain).toBe("number");
      expect(row.repo_fit).toBeTruthy();
    }
  });
});
