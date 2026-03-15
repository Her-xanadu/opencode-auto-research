import { z } from "zod";
import { controllerProposalContractSchema } from "../controller/schema";
export { controllerProposalContractSchema as proposalContractSchema } from "../controller/schema";

export const proposalCardSchema = controllerProposalContractSchema.extend({
  model_family: z.enum(["gpt", "claude", "gemini"]),
  role: z.string(),
  change_surface: z.string(),
  target_metric: z.string(),
  expected_direction: z.enum(["up", "down", "flat"]),
  confidence: z.number().min(0).max(1),
  risk: z.enum(["low", "medium", "high"]).optional(),
  single_change_ok: z.boolean(),
  abstain_reason: z.string().nullable(),
  veto: z.boolean().default(false),
});

export type ProposalCard = z.infer<typeof proposalCardSchema>;
