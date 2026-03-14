import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeKbWorkspace, repoRoot, runPython, tempDirs } from "./test-helpers";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("kb rank transferability", () => {
  it("raises posterior usefulness after repeated keep feedback", async () => {
    const { workspace, vaultRoot } = await makeKbWorkspace();
    const configPath = path.join(workspace, "configs", "research_brain.yaml");
    await runPython("scripts/kb/build_index.py", ["--vault-root", vaultRoot, "--workspace-root", workspace, "--config", configPath, "--scaffold-missing", "--extract-claims"], workspace);
    const feedbackPath = path.join(workspace, "experiments", "research", "paper-feedback.jsonl");
    await runPython("scripts/kb/update_paper_feedback.py", ["--input", path.join(repoRoot, "fixtures", "kb", "feedback", "keep.json"), "--output", feedbackPath], workspace);
    await runPython("scripts/kb/update_paper_feedback.py", ["--input", path.join(repoRoot, "fixtures", "kb", "feedback", "keep.json"), "--output", feedbackPath], workspace);
    const output = path.join(workspace, "experiments", "research", "posterior-rank.json");
    await runPython("scripts/kb/rank_transferability.py", ["--feedback", feedbackPath, "--output", output, "--workspace-root", workspace, "--config", configPath], workspace);
    const ranking = JSON.parse(await fs.readFile(output, "utf8"));
    expect(ranking["doi:10.1145/3718958.3750493"].posterior_usefulness).toBeGreaterThan(0);
  });
});
