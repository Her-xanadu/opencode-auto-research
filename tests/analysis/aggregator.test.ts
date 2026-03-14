import { describe, expect, it } from "vitest";
import { aggregateProposals } from "../../src/analysis/aggregator";

describe("proposal aggregator", () => {
  it("selects one primary change and records rejection reasons", () => {
    const result = aggregateProposals([
      {
        proposal_id: "g1",
        model_family: "gpt",
        role: "exploit",
        mechanism: "push",
        change_surface: "training",
        change_unit: "lr",
        target_metric: "metric",
        expected_direction: "up",
        confidence: 0.8,
        risk: "medium",
        single_change_ok: true,
        abstain_reason: null,
        veto: false,
      },
      {
        proposal_id: "c1",
        model_family: "claude",
        role: "validity_guard",
        mechanism: "validate",
        change_surface: "training",
        change_unit: "lr",
        target_metric: "metric",
        expected_direction: "flat",
        confidence: 0.7,
        risk: "low",
        single_change_ok: true,
        abstain_reason: null,
        veto: false,
      },
      {
        proposal_id: "g2",
        model_family: "gemini",
        role: "divergence",
        mechanism: "diverge",
        change_surface: "training",
        change_unit: "dropout",
        target_metric: "metric",
        expected_direction: "up",
        confidence: 0.6,
        risk: "medium",
        single_change_ok: true,
        abstain_reason: null,
        veto: false,
      },
    ]);
    expect(result.next_primary_change?.proposal_id).toBe("g1");
    expect(result.why_selected).toMatch(/highest confidence/i);
    expect(result.why_not_others.length).toBe(2);
  });
});
