import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeKbWorkspace, repoRoot, runPython, tempDirs } from "./test-helpers";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("kb evidence pack", () => {
  it("renders an evidence pack with bounded length", async () => {
    const { workspace, vaultRoot } = await makeKbWorkspace();
    const configPath = path.join(workspace, "configs", "research_brain.yaml");
    await runPython("scripts/kb/build_index.py", ["--vault-root", vaultRoot, "--workspace-root", workspace, "--config", configPath, "--scaffold-missing", "--extract-claims"], workspace);
    const retrieval = await runPython(
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
    const output = await runPython(
      "scripts/kb/make_evidence_pack.py",
      ["--round", "1", "--retrieval", retrieval.output, "--workspace-root", workspace, "--config", configPath],
      workspace,
    );
    const rendered = await fs.readFile(output.output, "utf8");
    expect(rendered).toContain("推荐论文 1（高度相关）");
    expect(rendered).toContain("正交论文 1");
    expect(rendered).toContain("警示论文 / SoK 1");
    expect(rendered).toContain("创新综合脊柱");
    expect(rendered).toContain("Apollo 主攻假设");
    expect(rendered).toContain("Apollo 组合机制");
    expect(rendered).toContain("Apollo 组合兼容分");
    expect(rendered).toContain("Killer ablation");
    expect(rendered).toContain("中间指标应先稳定改善");
    expect(rendered).toContain("Athena 守门提醒");
    expect(rendered.length).toBeGreaterThanOrEqual(500);
    expect(rendered.length).toBeLessThanOrEqual(2400);
  });
});
