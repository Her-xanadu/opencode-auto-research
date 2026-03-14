import { z } from "zod";

export const proposalCardSchema = z.object({
  proposal_id: z.string(),
  model_family: z.enum(["gpt", "claude", "gemini"]),
  role: z.string(),
  mechanism: z.string(),
  change_surface: z.string(),
  change_unit: z.string(),
  target_metric: z.string(),
  expected_direction: z.enum(["up", "down", "flat"]),
  confidence: z.number().min(0).max(1),
  risk: z.enum(["low", "medium", "high"]),
  single_change_ok: z.boolean(),
  abstain_reason: z.string().nullable(),
  veto: z.boolean().default(false),
});

export type ProposalCard = z.infer<typeof proposalCardSchema>;
