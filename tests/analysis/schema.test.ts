import { describe, expect, it } from "vitest";
import resultPacket from "../../fixtures/results/result-packet-good.json";
import { proposalCardSchema } from "../../src/analysis/proposal-card";
import { resultPacketSchema } from "../../src/analysis/result-packet";

describe("analysis schemas", () => {
  it("accepts a valid result packet and rejects invalid proposal cards", () => {
    expect(() => resultPacketSchema.parse(resultPacket)).not.toThrow();
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
