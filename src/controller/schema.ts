import { z } from "zod";

export const controllerDirectionEdgeSchema = z.object({
  weight: z.number().optional(),
  last_round: z.number().int().optional(),
  reason: z.string().optional(),
  metric_path_signature: z.string().optional(),
  failure_signature: z.string().optional(),
  failure_type: z.string().optional(),
  success_count: z.number().int().optional(),
  failure_count: z.number().int().optional(),
  crash_count: z.number().int().optional(),
  confidence: z.number().optional(),
});

export const controllerSessionSchema = z
  .object({
    session_id: z.string().min(1).optional(),
    loop_id: z.string().min(1).optional(),
    workspace_root: z.string().min(1).optional().nullable(),
    stage: z.string().min(1),
    state: z.string().optional(),
    message: z.string().optional().default(""),
    active_run_id: z.string().nullable().optional().default(null),
    active_dvc_task: z.string().nullable().optional().default(null),
    best_run_id: z.string().nullable().optional().default(null),
    best_metric: z.number().nullable().optional(),
    best_exp_ref: z.string().nullable().optional(),
    stop_reason: z.string().nullable().optional().default(null),
    iteration_count: z.number().int().nonnegative().optional().default(0),
    round: z.number().int().nonnegative().optional(),
    updated_at: z.string().optional().default(""),
    family_cooldowns: z.record(z.string(), z.number()).optional().default({}),
    family_failures: z.record(z.string(), z.number()).optional().default({}),
    redirect_memory: z.record(z.string(), z.unknown()).optional().default({}),
    direction_memory: z.record(z.string(), z.unknown()).optional().default({}),
    direction_memory_v2: z.record(z.string(), z.record(z.string(), controllerDirectionEdgeSchema)).optional().default({}),
    budget_used: z.record(z.string(), z.number()).optional().default({}),
  })
  .passthrough();

export const controllerPaperGroundingSchema = z
  .object({
    paper_id: z.string().min(1),
    title: z.string().optional(),
    slot: z.string().optional(),
    why_relevant: z.string().optional(),
    mechanism_transfer: z.string().optional(),
    risk_guardrail: z.string().optional(),
    mechanism_unit: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const controllerProposalContractSchema = z
  .object({
    proposal_id: z.string().optional(),
    title: z.string().optional(),
    family: z.string().optional(),
    mechanism: z.string().optional(),
    files_to_touch: z.array(z.string()).optional(),
    expected_gain: z.number().optional(),
    risk: z.string().optional(),
    why_not_parameter_only: z.string().optional(),
    minimal_ablation: z.union([z.string(), z.array(z.string())]).optional(),
    paper_grounding: z.array(controllerPaperGroundingSchema).optional().default([]),
    redirect_if_underperforming: z.string().optional(),
    causal_metric_path: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((value) => {
        if (!value) return [];
        return Array.isArray(value) ? value : [value];
      }),
    failure_signature: z.string().optional(),
    pivot_after_failure: z.string().optional(),
  })
  .passthrough();

export const controllerResearchContextSchema = z
  .object({
    research_context_id: z.string().optional(),
    retrieval_path: z.string().nullable().optional(),
    evidence_pack_path: z.string().nullable().optional(),
    selected: z.array(z.record(z.string(), z.unknown())).optional().default([]),
    innovation_briefs: z.record(z.string(), z.unknown()).optional().default({}),
    config_path: z.string().optional(),
    config: z.record(z.string(), z.unknown()).optional().default({}),
  })
  .passthrough();

export type ControllerSession = z.infer<typeof controllerSessionSchema>;
export type ControllerProposalContract = z.infer<typeof controllerProposalContractSchema>;
export type ControllerResearchContext = z.infer<typeof controllerResearchContextSchema>;

export const controllerRetrievalResultSchema = z
  .object({
    round: z.number().int().optional(),
    query_tokens: z.array(z.string()).optional().default([]),
    cooldowns: z.array(z.string()).optional().default([]),
    selected: z.array(z.record(z.string(), z.unknown())).optional().default([]),
    top_ranked: z.array(z.record(z.string(), z.unknown())).optional().default([]),
    innovation_briefs: z.record(z.string(), z.unknown()).optional().default({}),
    output: z.string().optional(),
  })
  .passthrough();

export const controllerEvidenceMetadataSchema = z
  .object({
    round: z.number().int().optional(),
    output: z.string().optional(),
    char_count: z.number().int().optional(),
    selected_count: z.number().int().optional(),
  })
  .passthrough();
