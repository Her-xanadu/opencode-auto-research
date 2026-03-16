import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("model source consistency", () => {
  it("keeps primary agent defaults in opencode.json instead of hardcoded TS models", async () => {
    const orchestrator = await fs.readFile(path.join(repoRoot, "src", "agents", "sisyphus-experiment-orchestrator.ts"), "utf8");
    const planner = await fs.readFile(path.join(repoRoot, "src", "agents", "prometheus-bootstrap-planner.ts"), "utf8");
    expect(orchestrator).not.toContain('model: "openai/gpt-5.4"');
    expect(planner).not.toContain('model: "openai/gpt-5.4"');

    const opencodeConfig = JSON.parse(await fs.readFile(path.join(repoRoot, "opencode.json"), "utf8"));
    expect(opencodeConfig.agent.Apollo.model).toBeTruthy();
  });
});
