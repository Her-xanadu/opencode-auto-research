import { createId } from "../utils/ids";
import type { ResultPacket } from "./result-packet";
import type { ProposalCard } from "./proposal-card";

export const TRI_MODEL_ANALYSIS_MODE = "legacy_placeholder" as const;

export function runTriModelAnalysis(packet: ResultPacket): ProposalCard[] {
  return [
    {
      proposal_id: createId("proposal"),
      model_family: "gpt",
      role: "exploit",
      family: packet.change_class,
      mechanism: "push the current most promising variable",
      paper_grounding: [],
      causal_metric_path: [],
      change_surface: packet.change_class,
      change_unit: `${packet.change_unit}-exploit`,
      target_metric: "primary_metric",
      expected_direction: "up",
      confidence: 0.82,
      risk: "medium",
      single_change_ok: true,
      abstain_reason: null,
      veto: false,
    },
    {
      proposal_id: createId("proposal"),
      model_family: "claude",
      role: "validity_guard",
      family: packet.change_class,
      mechanism: packet.monitor_summary.state === "failed" ? "block invalid measurement" : "validate current evidence",
      paper_grounding: [],
      causal_metric_path: [],
      change_surface: packet.change_class,
      change_unit: packet.change_unit,
      target_metric: "primary_metric",
      expected_direction: "flat",
      confidence: 0.9,
      risk: "low",
      single_change_ok: true,
      abstain_reason: null,
      veto: packet.monitor_summary.state === "failed" || packet.decision_status === "review",
    },
    {
      proposal_id: createId("proposal"),
      model_family: "gemini",
      role: "divergence",
      family: packet.change_class,
      mechanism: "propose an orthogonal measurable alternative",
      paper_grounding: [],
      causal_metric_path: [],
      change_surface: packet.change_class,
      change_unit: `${packet.change_unit}-divergent`,
      target_metric: "primary_metric",
      expected_direction: "up",
      confidence: 0.67,
      risk: "medium",
      single_change_ok: true,
      abstain_reason: null,
      veto: false,
    },
  ];
}
