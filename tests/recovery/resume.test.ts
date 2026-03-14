import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resumeExperiment } from "../../src/recovery/resume";

describe("recovery resume", () => {
  it("resumes from the latest checkpoint or parent state", async () => {
    const workspace = fileURLToPath(new URL("../../fixtures/runs/crash-after-checkpoint", import.meta.url));
    const result = await resumeExperiment(workspace);
    expect(result.resumed).toBe(true);
    expect(String(result.source)).toMatch(/checkpoint|run-parent/);
  });
});
