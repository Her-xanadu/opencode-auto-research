import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeKbWorkspace, runPython, tempDirs } from "./test-helpers";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("kb claims extraction", () => {
  it("extracts mechanism, limitation, and transfer_hint claims from markdown", async () => {
    const { workspace, vaultRoot } = await makeKbWorkspace();
    await runPython(
      "scripts/kb/build_index.py",
      [
        "--vault-root",
        vaultRoot,
        "--workspace-root",
        workspace,
        "--config",
        path.join(workspace, "configs", "research_brain.yaml"),
        "--scaffold-missing",
        "--extract-claims",
      ],
      workspace,
    );
    const claimsText = await fs.readFile(path.join(vaultRoot, "tao-net", "claims.jsonl"), "utf8");
    expect(claimsText).toContain('"claim_type": "mechanism"');
    expect(claimsText).toContain('"claim_type": "limitation"');
    expect(claimsText).toContain('"claim_type": "transfer_hint"');
  });
});
