import { describe, expect, it } from "vitest";
import resultPacket from "../../fixtures/results/result-packet-good.json";
import { runTriModelAnalysis } from "../../src/analysis/tri-model";
import type { ResultPacket } from "../../src/analysis/result-packet";

describe("tri-model analysis", () => {
  it("returns structured proposal cards for gpt, claude, and gemini", () => {
    const cards = runTriModelAnalysis(resultPacket as ResultPacket);
    expect(cards.map((card) => card.model_family)).toEqual(expect.arrayContaining(["gpt", "claude", "gemini"]));
    expect(cards.every((card) => typeof card.single_change_ok === "boolean")).toBe(true);
  });
});
