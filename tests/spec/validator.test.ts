import { describe, expect, it } from "vitest";
import validSpec from "../../fixtures/specs/valid-spec.json";
import invalidSpec from "../../fixtures/specs/invalid-spec-missing-eval.json";
import { validateExperimentSpec } from "../../src/spec/validator";

describe("experiment spec validator", () => {
  it("accepts a valid spec fixture", () => {
    const result = validateExperimentSpec(validSpec);
    expect(result.valid).toBe(true);
  });

  it("rejects a spec missing eval fields", () => {
    const result = validateExperimentSpec(invalidSpec);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/eval_command/);
  });
});
