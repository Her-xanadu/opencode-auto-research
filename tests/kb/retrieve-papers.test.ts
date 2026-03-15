import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeKbWorkspace, repoRoot, runPython, tempDirs } from "./test-helpers";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("kb retrieve papers", () => {
  it("returns fixed 2+1+1 evidence units", async () => {
    const { workspace, vaultRoot } = await makeKbWorkspace();
    const configPath = path.join(workspace, "configs", "research_brain.yaml");
    await runPython("scripts/kb/build_index.py", ["--vault-root", vaultRoot, "--workspace-root", workspace, "--config", configPath, "--scaffold-missing", "--extract-claims"], workspace);
    const result = await runPython(
      "scripts/kb/retrieve_papers.py",
      [
        "--goal",
        path.join(repoRoot, "fixtures", "kb", "runtime", "goal.json"),
        "--session",
        path.join(repoRoot, "fixtures", "kb", "runtime", "session.json"),
        "--best",
        path.join(repoRoot, "fixtures", "kb", "runtime", "best.json"),
        "--attempts",
        path.join(repoRoot, "fixtures", "kb", "runtime", "attempts.jsonl"),
        "--workspace-root",
        workspace,
        "--config",
        configPath,
      ],
      workspace,
    );
    const slots = result.selected.map((item: any) => item.slot);
    expect(slots.filter((slot: string) => slot === "relevant").length).toBe(2);
    expect(slots.filter((slot: string) => slot === "orthogonal").length).toBe(1);
    expect(slots.filter((slot: string) => slot === "cautionary").length).toBe(1);
    const cautionary = result.selected.find((item: any) => item.slot === "cautionary");
    expect(cautionary.title_zh).toContain("SoK");
    expect(result.innovation_briefs.apollo.hypothesis_seed).toBeTruthy();
    expect(result.innovation_briefs.apollo.composed_hypothesis).toBeTruthy();
    expect(result.innovation_briefs.apollo.lead_mech_id).toBeTruthy();
    expect(result.innovation_briefs.apollo.support_mech_id).toBeTruthy();
    expect(result.innovation_briefs.apollo.compatibility_score).toBeGreaterThan(0);
    expect(result.innovation_briefs.apollo.lead_unit.mechanism_verb).toBeTruthy();
    expect(Array.isArray(result.innovation_briefs.apollo.causal_metric_path)).toBe(true);
    expect(result.innovation_briefs.apollo.causal_metric_path.length).toBeGreaterThan(1);
    expect(result.innovation_briefs.athena.guardrails.length).toBeGreaterThan(0);
    expect(result.selected[0].mechanism_units.length).toBeGreaterThan(0);
    expect(result.selected[0].metric_paths.length).toBeGreaterThan(0);
    expect(result.selected[0].mechanism_units[0].intervention).not.toContain("作者解决了什么问题");
    expect(result.selected[0].mechanism_units[0].intervention).not.toBe("1.");
    expect(result.selected[0].mechanism_units[0].action_sentence.startsWith("对")).toBe(true);
    expect(result.innovation_briefs.apollo.composed_hypothesis).toContain("先对");
  });
});
