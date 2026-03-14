import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeKbWorkspace, runPython, tempDirs } from "./test-helpers";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("kb fill figure notes", () => {
  it("replaces placeholder figure-note content with structured summaries", async () => {
    const { workspace, vaultRoot } = await makeKbWorkspace();
    const taoFigure = path.join(vaultRoot, "tao-net", "figure-note.md");
    await fs.writeFile(
      taoFigure,
      [
        "# TAO 图示解读",
        "",
        "- 架构图来源: tao-net-架构图.canvas",
        "- 主要模块: 待补充",
        "- 输入输出: 待补充",
        "- 模块关系: 待补充",
        "- 相比常规方法的差异: 待补充",
        "- 适配当前实验的潜在切入点: 待补充",
        "",
      ].join("\n"),
      "utf8",
    );
    await runPython("scripts/kb/build_index.py", ["--vault-root", vaultRoot, "--workspace-root", workspace, "--config", path.join(workspace, "configs", "research_brain.yaml"), "--scaffold-missing", "--extract-claims"], workspace);
    const result = await runPython("scripts/kb/fill_figure_notes.py", ["--vault-root", vaultRoot], workspace);
    expect(result.updated_count).toBeGreaterThan(0);
    const rendered = await fs.readFile(taoFigure, "utf8");
    expect(rendered).not.toContain("待补充");
    expect(rendered).toContain("核心机制摘要");
  });
});
