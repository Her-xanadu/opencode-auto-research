import type { ProposalCard } from "./proposal-card";

export interface AggregatedProposal {
  next_primary_change: ProposalCard | null;
  why_selected: string;
  why_not_others: string[];
}

export function aggregateProposals(cards: ProposalCard[]): AggregatedProposal {
  const valid = cards.filter((card) => card.single_change_ok && !card.abstain_reason);
  const veto = valid.find((card) => card.model_family === "claude" && card.veto);
  if (veto) {
    return {
      next_primary_change: null,
      why_selected: "Athena vetoed the next iteration",
      why_not_others: valid.filter((card) => card !== veto).map((card) => `${card.model_family}: blocked by validity veto`),
    };
  }
  const ranked = [...valid].sort((a, b) => b.confidence - a.confidence);
  const winner = ranked[0] ?? null;
  return {
    next_primary_change: winner,
    why_selected: winner ? `${winner.model_family} had the highest confidence under the single-change constraint` : "no valid proposal available",
    why_not_others: ranked.slice(1).map((card) => `${card.model_family}: lower confidence than ${winner?.model_family ?? "winner"}`),
  };
}
