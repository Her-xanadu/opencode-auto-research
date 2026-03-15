import { describe, expect, it } from "vitest";
import resultPacket from "../../fixtures/results/result-packet-good.json";
import { proposalCardSchema, proposalContractSchema } from "../../src/analysis/proposal-card";
import { controllerSessionSchema, resultPacketSchema } from "../../src/analysis/result-packet";

describe("analysis schemas", () => {
  it("accepts a valid result packet and rejects invalid proposal cards", () => {
    expect(() => resultPacketSchema.parse(resultPacket)).not.toThrow();
    expect(() =>
      proposalContractSchema.parse({
        family: "objective.loss",
        mechanism: "对目标函数做正则化，预期先改善中间稳定性指标，再影响目标指标。",
        redirect_if_underperforming: "切换到表征路线",
      }),
    ).not.toThrow();
    expect(() =>
      controllerSessionSchema.parse({
        session_id: "s1",
        stage: "ready_to_execute",
        direction_memory_v2: { "objective.loss|generic-underperform": { "repr.feature": { weight: 1.0, confidence: 0.5 } } },
      }),
    ).not.toThrow();
    expect(() =>
      proposalCardSchema.parse({
        proposal_id: "bad",
        model_family: "gpt",
        role: "exploit",
        mechanism: "bad",
        change_surface: "surface",
        change_unit: "unit",
        target_metric: "metric",
        expected_direction: "sideways",
        confidence: 2,
        risk: "low",
        single_change_ok: true,
        abstain_reason: null,
      }),
    ).toThrow();
  });
});
