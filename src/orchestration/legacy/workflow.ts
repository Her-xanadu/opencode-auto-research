import { z } from "zod";
import type { PluginInput, ToolContext } from "../../opencode-plugin";
import { proposalCardSchema, type ProposalCard } from "../../analysis/proposal-card";
import { runTriModelAnalysis } from "../../analysis/tri-model";
import { buildSession, loadSession, saveSession } from "../../experiment/session";
import { executeIteration, type IterationResult } from "../../loop/execute-iteration";
import { decideIteration } from "../../loop/decider";
import { loadMonitorSummary, type MonitorSummary } from "../../monitor/controller";
import { SpecialistInvocationError, runSpecialistSession, type SpecialistAgentName } from "../specialist-runner";
import { resumeExperiment } from "../../recovery/resume";
import type { ExperimentSpec } from "../../spec/schema";
import { appendJsonl, readJson, readJsonl, writeJson } from "../../utils/fs";
import { createId } from "../../utils/ids";
import {
  getBestPath,
  getOrchestrationSummaryPath,
  getOrchestrationTracePath,
  getRunEventsPath,
  getRunsPath,
  getWorkspaceConfigPath,
} from "../../utils/paths";
import { nowIso } from "../../utils/time";
import { PROMETHEUS_PLANNER_AGENT, SISYPHUS_JUNIOR_AGENT, SISYPHUS_ORCHESTRATOR_AGENT } from "../../agents";

const orchestrationStepSchema = z.object({
  step_id: z.string(),
  actor: z.string(),
  phase: z.enum(["resume", "analysis", "mutation", "monitor", "judge", "control"]),
  status: z.enum(["completed", "skipped", "blocked"]),
  summary: z.string(),
  payload: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});

export type OrchestrationStep = z.infer<typeof orchestrationStepSchema>;

export interface GovernedWorkflowResult {
  workflow_id: string;
  stop_reason: string | null;
  total_iterations: number;
  best_metric: number | null;
  latest_decision: "keep" | "discard" | "crash" | "review" | "blocked" | null;
  active_run_id: string | null;
  steps: OrchestrationStep[];
}

interface SpecialistExecutionMeta {
  mode: "live" | "fallback";
  fallback_reason: string | null;
  raw_excerpt: string | null;
}

interface SpecialistAuditRecord {
  actor: string;
  phase: OrchestrationStep["phase"];
  session_id: string | null;
  execution_mode: "live" | "fallback" | null;
  fallback_reason: string | null;
  raw_excerpt: string | null;
}

export interface GovernedWorkflowSummary extends GovernedWorkflowResult {
  specialist_audit: SpecialistAuditRecord[];
}

const mutationRequestSchema = z.object({
  change_class: z.enum(["hyperparameter", "config_switch", "module_swap"]),
  change_unit: z.string(),
  target_file: z.string(),
  params: z.record(z.string(), z.unknown()),
});

const rawProposalCandidateSchema = z.object({
  change_class: z.string(),
  change_unit: z.string(),
  target_file: z.string(),
  params: z.record(z.string(), z.unknown()),
  mechanism: z.string(),
  confidence: z.coerce.number().min(0).max(1),
  risk: z.string(),
});

const proposalCandidateSchema = mutationRequestSchema.extend({
  mechanism: z.string(),
  confidence: z.number().min(0).max(1),
  risk: z.enum(["low", "medium", "high"]),
});

const analystResponseSchema = z.object({
  primary: rawProposalCandidateSchema,
  backup: rawProposalCandidateSchema.nullable(),
});

const guardResponseSchema = z.object({
  verdict: z.enum(["approve", "veto"]),
  validity_risks: z.array(z.string()),
  smallest_repair: z.string().nullable(),
  single_change_ok: z.boolean(),
});

const recoveryResponseSchema = z.object({
  recovery_action: z.enum(["resume_checkpoint", "restore_parent", "cannot_recover"]),
  recovery_source: z.string().nullable(),
  why_this_is_safe: z.string(),
  next_session_stage: z.string(),
});

const mutationWorkerResponseSchema = z.object({
  run_id: z.string(),
  baseline_metric: z.number(),
  current_metric: z.number(),
  status: z.enum(["keep", "discard", "crash", "review"]),
  next_primary_change: z.string().nullable(),
  change_class: z.enum(["hyperparameter", "config_switch", "module_swap"]),
  change_unit: z.string(),
  touched_files: z.array(z.string()),
  diff_summary: z.string(),
  monitor_state: z.string(),
  session_stage: z.string().optional(),
});

const watcherResponseSchema = z.object({
  run_state: z.enum(["running", "stalled", "failed", "completed", "recoverable"]),
  last_meaningful_event: z.string().nullable(),
  checkpoint_available: z.boolean(),
  metric_reported: z.boolean(),
  monitor_summary: z.string(),
});

const judgeResponseSchema = z.object({
  status: z.enum(["keep", "discard", "crash", "review"]),
  reason: z.string(),
  confidence_note: z.string(),
});

type MutationRequest = z.infer<typeof mutationRequestSchema>;
type ProposalCandidate = z.infer<typeof proposalCandidateSchema>;

function createStep(
  actor: string,
  phase: OrchestrationStep["phase"],
  status: OrchestrationStep["status"],
  summary: string,
  payload: Record<string, unknown>,
): OrchestrationStep {
  return orchestrationStepSchema.parse({
    step_id: createId("orchestration_step"),
    actor,
    phase,
    status,
    summary,
    payload,
    created_at: nowIso(),
  });
}

function buildDelegationPrompt(input: {
  task: string;
  expectedOutcome: string;
  requiredTools: string[];
  mustDo: string[];
  mustNotDo: string[];
  context: Record<string, unknown>;
}): string {
  return [
    "TASK",
    input.task,
    "",
    "EXPECTED OUTCOME",
    input.expectedOutcome,
    "",
    "REQUIRED TOOLS",
    input.requiredTools.join("\n"),
    "",
    "MUST DO",
    input.mustDo.map((line, index) => `${index + 1}. ${line}`).join("\n"),
    "",
    "MUST NOT DO",
    input.mustNotDo.map((line) => `- ${line}`).join("\n"),
    "",
    "CONTEXT",
    JSON.stringify(input.context, null, 2),
  ].join("\n");
}

function buildAuditExcerpt(value: unknown, limit = 280): string {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const normalized = serialized.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 1)}...`;
}

function extractJsonBlock(text: string): string {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  const candidates = [objectStart, arrayStart].filter((index) => index >= 0);
  if (candidates.length === 0) {
    return text.trim();
  }
  const start = Math.min(...candidates);
  const objectEnd = text.lastIndexOf("}");
  const arrayEnd = text.lastIndexOf("]");
  const end = Math.max(objectEnd, arrayEnd);
  if (end < start) {
    return text.trim();
  }
  return text.slice(start, end + 1).trim();
}

function parseSpecialistJson<T>(schema: z.ZodSchema<T>, text: string): T {
  return schema.parse(JSON.parse(extractJsonBlock(text)));
}

function toProposalCard(input: ProposalCandidate, modelFamily: ProposalCard["model_family"], role: string): ProposalCard {
  return proposalCardSchema.parse({
    proposal_id: createId("proposal"),
    model_family: modelFamily,
    role,
    family: input.change_class,
    mechanism: input.mechanism,
    paper_grounding: [],
    causal_metric_path: [],
    change_surface: input.change_class,
    change_unit: input.change_unit,
    target_metric: "primary_metric",
    expected_direction: "up",
    confidence: input.confidence,
    risk: input.risk,
    single_change_ok: true,
    abstain_reason: null,
    veto: false,
  });
}

function buildMutationRequestFromProposal(proposal: ProposalCandidate): MutationRequest {
  return mutationRequestSchema.parse({
    change_class: proposal.change_class,
    change_unit: proposal.change_unit,
    target_file: proposal.target_file,
    params: proposal.params,
  });
}

function normalizeChangeClass(
  rawChangeClass: string,
  fallbackClass: "hyperparameter" | "config_switch" | "module_swap",
): "hyperparameter" | "config_switch" | "module_swap" {
  const normalized = rawChangeClass.trim().toLowerCase();
  if (normalized === "hyperparameter" || normalized === "config_switch" || normalized === "module_swap") {
    return normalized;
  }
  if (normalized.includes("config") || normalized.includes("schedule") || normalized.includes("strategy")) {
    return "config_switch";
  }
  if (normalized.includes("architecture") || normalized.includes("model") || normalized.includes("module")) {
    return "module_swap";
  }
  return fallbackClass;
}

function normalizeProposalCandidate(input: {
  candidate: z.infer<typeof rawProposalCandidateSchema>;
  fallbackClass: "hyperparameter" | "config_switch" | "module_swap";
  iteration: number;
}): ProposalCandidate {
  const normalizedRisk = input.candidate.risk.trim().toLowerCase();
  const risk: "low" | "medium" | "high" =
    normalizedRisk === "low" || normalizedRisk === "medium" || normalizedRisk === "high"
      ? normalizedRisk
      : normalizedRisk.includes("med") || normalizedRisk.includes("moder")
        ? "medium"
        : normalizedRisk.includes("high")
          ? "high"
          : "low";
  const changeClass = normalizeChangeClass(input.candidate.change_class, input.fallbackClass);
  if (changeClass === "hyperparameter") {
    const explicitValue = Object.values(input.candidate.params).find((value) => typeof value === "number") as number | undefined;
    return proposalCandidateSchema.parse({
      change_class: changeClass,
      change_unit: input.candidate.change_unit,
      target_file: "src/config.json",
      params: {
        key: String(input.candidate.params.key ?? input.candidate.change_unit),
        value: explicitValue ?? Number((0.55 + input.iteration * 0.1).toFixed(2)),
      },
      mechanism: input.candidate.mechanism,
      confidence: input.candidate.confidence,
      risk,
    });
  }

  if (changeClass === "config_switch") {
    return proposalCandidateSchema.parse({
      change_class: changeClass,
      change_unit: input.candidate.change_unit,
      target_file: "src/strategy.txt",
      params: {
        search: String(input.candidate.params.search ?? "baseline"),
        replace: String(input.candidate.params.replace ?? input.candidate.change_unit),
      },
      mechanism: input.candidate.mechanism,
      confidence: input.candidate.confidence,
      risk,
    });
  }

  return proposalCandidateSchema.parse({
    change_class: changeClass,
    change_unit: input.candidate.change_unit,
    target_file: "src/module.ts",
    params: {
      content: String(input.candidate.params.content ?? `export const variant = ${input.iteration};\n`),
    },
    mechanism: input.candidate.mechanism,
    confidence: input.candidate.confidence,
    risk,
  });
}

function hasLiveRuntime(runtime?: PluginInput, toolContext?: ToolContext): runtime is PluginInput {
  return Boolean(runtime?.client && toolContext?.sessionID);
}

function buildProposalSeed(input: {
  baselineMetric: number;
  currentMetric: number;
  previousChangeClass: "hyperparameter" | "config_switch" | "module_swap";
  previousChangeUnit: string;
}): {
  run_id: string;
  baseline_metric: number;
  current_metric: number;
  best_metric: number;
  metric_delta: number;
  change_class: "hyperparameter" | "config_switch" | "module_swap";
  change_unit: string;
  change_manifest: { primary_object: string; secondary_objects: string[] };
  monitor_summary: { state: string };
  decision_status: "keep" | "discard" | "crash" | "review";
} {
  return {
    run_id: createId("seed_run"),
    baseline_metric: input.baselineMetric,
    current_metric: input.currentMetric,
    best_metric: Math.max(input.baselineMetric, input.currentMetric),
    metric_delta: input.currentMetric - input.baselineMetric,
    change_class: input.previousChangeClass,
    change_unit: input.previousChangeUnit,
    change_manifest: {
      primary_object: input.previousChangeUnit,
      secondary_objects: [],
    },
    monitor_summary: { state: "completed" },
    decision_status: input.currentMetric >= input.baselineMetric ? "keep" : "discard",
  };
}

function resolveProposalSet(cards: ProposalCard[]): {
  exploit: ProposalCard;
  guard: ProposalCard;
  divergence: ProposalCard;
  primary: ProposalCard | null;
  backup: ProposalCard | null;
  rationale: string;
} {
  const exploit = cards.find((card) => card.model_family === "gpt");
  const guard = cards.find((card) => card.model_family === "claude");
  const divergence = cards.find((card) => card.model_family === "gemini");

  if (!exploit || !guard || !divergence) {
    throw new Error("tri-model analysis did not produce gpt, claude, and gemini proposal cards");
  }

  if (!guard.veto && exploit.single_change_ok) {
    return {
      exploit,
      guard,
      divergence,
      primary: exploit,
      backup: divergence.single_change_ok ? divergence : null,
      rationale: "exploit proposal approved by validity guard",
    };
  }

  if (divergence.single_change_ok) {
    return {
      exploit,
      guard,
      divergence,
      primary: divergence,
      backup: null,
      rationale: "primary exploit proposal vetoed; falling back to divergence proposal",
    };
  }

  return {
    exploit,
    guard,
    divergence,
    primary: null,
    backup: null,
    rationale: "no valid proposal remains after guard evaluation",
  };
}

function nextChangeClass(previous: "hyperparameter" | "config_switch" | "module_swap") {
  if (previous === "hyperparameter") return "config_switch" as const;
  if (previous === "config_switch") return "module_swap" as const;
  return "hyperparameter" as const;
}

function buildMutationRequest(input: {
  iteration: number;
  proposal: ProposalCard;
  previousChangeClass: "hyperparameter" | "config_switch" | "module_swap";
}) {
  const changeClass =
    input.proposal.model_family === "gemini"
      ? nextChangeClass(input.previousChangeClass)
      : input.previousChangeClass;

  if (changeClass === "hyperparameter") {
    return {
      change_class: changeClass,
      change_unit: input.proposal.change_unit,
      target_file: "src/config.json",
      params: {
        key: "learning_rate",
        value: Number((0.55 + input.iteration * 0.1).toFixed(2)),
      },
    };
  }

  if (changeClass === "config_switch") {
    return {
      change_class: changeClass,
      change_unit: input.proposal.change_unit,
      target_file: "src/strategy.txt",
      params: {
        search: "baseline",
        replace: `variant_${input.iteration}`,
      },
    };
  }

  return {
    change_class: changeClass,
    change_unit: input.proposal.change_unit,
    target_file: "src/module.ts",
    params: {
      content: `export const variant = ${input.iteration};\n`,
    },
  };
}

async function appendStep(workspaceRoot: string, step: OrchestrationStep): Promise<void> {
  await appendJsonl(getOrchestrationTracePath(workspaceRoot), step);
}

async function loadBestMetric(workspaceRoot: string): Promise<number | null> {
  const best = await readJson<{ current_best?: { metric: number } | null }>(getBestPath(workspaceRoot), {});
  return best.current_best?.metric ?? null;
}

async function invokeSpecialistLive<T>(input: {
  runtime: PluginInput;
  toolContext: ToolContext;
  agent: SpecialistAgentName;
  description: string;
  prompt: string;
  schema: z.ZodSchema<T>;
}): Promise<{ parsed: T; sessionID: string; rawExcerpt: string }> {
  const response = await runSpecialistSession({
    runtime: input.runtime,
    toolContext: input.toolContext,
    invocation: {
      agent: input.agent,
      description: input.description,
      prompt: input.prompt,
    },
  });
  try {
    return {
      parsed: parseSpecialistJson(input.schema, response.text),
      sessionID: response.sessionID,
      rawExcerpt: response.rawExcerpt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SpecialistInvocationError(
      `live specialist ${input.agent} parse failed in session ${response.sessionID}: ${message}`,
      response.sessionID,
      response.rawExcerpt,
    );
  }
}

async function invokeRecoveryOperator(input: {
  workspaceRoot: string;
  priorStage: string;
  runtime?: PluginInput;
  toolContext?: ToolContext;
}): Promise<{ response: z.infer<typeof recoveryResponseSchema>; sessionID: string | null; execution: SpecialistExecutionMeta }> {
  const resumeState = await resumeExperiment(input.workspaceRoot);
  if (!hasLiveRuntime(input.runtime, input.toolContext)) {
    const response = recoveryResponseSchema.parse({
      recovery_action: resumeState.source?.includes("checkpoint") ? "resume_checkpoint" : resumeState.resumed ? "restore_parent" : "cannot_recover",
      recovery_source: resumeState.source,
      why_this_is_safe: resumeState.resumed ? "reused the latest recoverable state" : "no recovery source was available",
      next_session_stage: resumeState.resumed ? "crash_recoverable" : input.priorStage,
    });
    return {
      response,
      sessionID: null,
      execution: { mode: "fallback", fallback_reason: null, raw_excerpt: buildAuditExcerpt(response) },
    };
  }

  const liveRuntime = input.runtime as PluginInput;
  const liveToolContext = input.toolContext as ToolContext;
  try {
    const liveResult = await invokeSpecialistLive({
      runtime: liveRuntime,
      toolContext: liveToolContext,
      agent: PROMETHEUS_PLANNER_AGENT,
      description: "Bootstrap or review-blocked replanning",
      prompt: buildDelegationPrompt({
        task: "Produce the narrowest bootstrap or review-blocked recovery plan for this experiment session.",
        expectedOutcome: "Return JSON only with recovery_action, recovery_source, why_this_is_safe, and next_session_stage.",
        requiredTools: ["- experiment_plan_or_resume", "- experiment_status"],
        mustDo: [
          "Call experiment_plan_or_resume exactly once.",
          "Base the answer only on the recoverable source that exists.",
          "Behave as Prometheus and do not execute code changes.",
          "Return only valid JSON with the requested keys.",
        ],
        mustNotDo: [
          "Do not add markdown or explanation outside JSON.",
          "Do not fabricate checkpoints or parent state.",
        ],
        context: {
          workspace_root: input.workspaceRoot,
          previous_stage: input.priorStage,
          resume_state: resumeState,
        },
      }),
      schema: recoveryResponseSchema,
    });
    return { response: liveResult.parsed, sessionID: liveResult.sessionID, execution: { mode: "live", fallback_reason: null, raw_excerpt: liveResult.rawExcerpt } };
  } catch (error) {
    const fallback = await invokeRecoveryOperator({ ...input, runtime: undefined, toolContext: undefined });
    return {
      ...fallback,
      execution: {
        mode: "fallback",
        fallback_reason: error instanceof Error ? error.message : String(error),
        raw_excerpt: error instanceof SpecialistInvocationError ? error.rawExcerpt : null,
      },
    };
  }
}

async function invokeAnalyst(input: {
  agent: "Apollo" | "Hermes";
  workspaceRoot: string;
  baselineMetric: number;
  previousChangeClass: "hyperparameter" | "config_switch" | "module_swap";
  previousChangeUnit: string;
  iteration: number;
  runtime?: PluginInput;
  toolContext?: ToolContext;
}): Promise<{ response: z.infer<typeof analystResponseSchema>; sessionID: string | null; execution: SpecialistExecutionMeta }> {
  if (!hasLiveRuntime(input.runtime, input.toolContext)) {
    const seed = buildProposalSeed({
      baselineMetric: input.baselineMetric,
      currentMetric: input.baselineMetric,
      previousChangeClass: input.previousChangeClass,
      previousChangeUnit: input.previousChangeUnit,
    });
    const cards = runTriModelAnalysis(seed);
    const primaryCard = cards.find((card) => card.model_family === (input.agent === "Apollo" ? "gpt" : "gemini"));
    const backupCard = cards.find((card) => card.model_family === (input.agent === "Apollo" ? "gemini" : "gpt"));
    if (!primaryCard || !backupCard) {
      throw new Error(`missing proposal cards for ${input.agent}`);
    }
    const primaryMutation = buildMutationRequest({
      iteration: input.iteration,
      proposal: primaryCard,
      previousChangeClass: input.previousChangeClass,
    });
    const backupMutation = buildMutationRequest({
      iteration: input.iteration + 1,
      proposal: backupCard,
      previousChangeClass: input.previousChangeClass,
    });
    const response = analystResponseSchema.parse({
      primary: {
        ...primaryMutation,
        mechanism: primaryCard.mechanism,
        confidence: primaryCard.confidence,
        risk: primaryCard.risk,
      },
      backup: {
        ...backupMutation,
        mechanism: backupCard.mechanism,
        confidence: backupCard.confidence,
        risk: backupCard.risk,
      },
    });
    return {
      response,
      sessionID: null,
      execution: { mode: "fallback", fallback_reason: null, raw_excerpt: buildAuditExcerpt(response) },
    };
  }

  const roleLabel = input.agent === "Apollo" ? "main exploit proposal" : "orthogonal backup proposal";
  const liveRuntime = input.runtime as PluginInput;
  const liveToolContext = input.toolContext as ToolContext;
  try {
    const liveResult = await invokeSpecialistLive({
      runtime: liveRuntime,
      toolContext: liveToolContext,
      agent: input.agent,
      description: `Generate ${roleLabel}`,
      prompt: buildDelegationPrompt({
        task: `Produce the ${roleLabel} for the next governed experiment iteration.`,
        expectedOutcome: "Return JSON only with primary and backup proposals. Each proposal must include change_class, change_unit, target_file, params, mechanism, confidence, and risk.",
        requiredTools: ["- experiment_status"],
        mustDo: [
          "Call experiment_status exactly once before proposing a change.",
          "Keep every proposal within the single-change rule.",
          "Use only these change_class values: hyperparameter, config_switch, module_swap.",
          "Use only these target_file values: src/config.json, src/strategy.txt, src/module.ts.",
          "For hyperparameter params use { key, value }. For config_switch params use { search, replace }. For module_swap params use { content }.",
          "Return only valid JSON with primary and backup keys.",
        ],
        mustNotDo: [
          "Do not output prose outside JSON.",
          "Do not omit target_file or params.",
          "Do not propose multiple primary changes in one candidate.",
        ],
        context: {
          workspace_root: input.workspaceRoot,
          baseline_metric: input.baselineMetric,
          previous_change_class: input.previousChangeClass,
          previous_change_unit: input.previousChangeUnit,
          iteration: input.iteration,
          allowed_change_classes: ["hyperparameter", "config_switch", "module_swap"],
          allowed_target_files: {
            hyperparameter: "src/config.json",
            config_switch: "src/strategy.txt",
            module_swap: "src/module.ts",
          },
        },
      }),
      schema: analystResponseSchema,
    });
    return { response: liveResult.parsed, sessionID: liveResult.sessionID, execution: { mode: "live", fallback_reason: null, raw_excerpt: liveResult.rawExcerpt } };
  } catch (error) {
    const fallback = await invokeAnalyst({ ...input, runtime: undefined, toolContext: undefined });
    return {
      ...fallback,
      execution: {
        mode: "fallback",
        fallback_reason: error instanceof Error ? error.message : String(error),
        raw_excerpt: error instanceof SpecialistInvocationError ? error.rawExcerpt : null,
      },
    };
  }
}

async function invokeValidityGuard(input: {
  workspaceRoot: string;
  primaryProposal: ProposalCandidate;
  backupProposal: ProposalCandidate | null;
  runtime?: PluginInput;
  toolContext?: ToolContext;
}): Promise<{ response: z.infer<typeof guardResponseSchema>; sessionID: string | null; execution: SpecialistExecutionMeta }> {
  if (!hasLiveRuntime(input.runtime, input.toolContext)) {
    const isSingleChange = Boolean(input.primaryProposal.change_unit && input.primaryProposal.target_file);
    const response = guardResponseSchema.parse({
      verdict: isSingleChange ? "approve" : "veto",
      validity_risks: isSingleChange ? [] : ["proposal is missing a clear single change unit"],
      smallest_repair: isSingleChange ? null : "reduce the proposal to one target file and one change unit",
      single_change_ok: isSingleChange,
    });
    return {
      response,
      sessionID: null,
      execution: { mode: "fallback", fallback_reason: null, raw_excerpt: buildAuditExcerpt(response) },
    };
  }

  const liveRuntime = input.runtime as PluginInput;
  const liveToolContext = input.toolContext as ToolContext;
  try {
    const liveResult = await invokeSpecialistLive({
      runtime: liveRuntime,
      toolContext: liveToolContext,
      agent: "Athena",
      description: "Validate primary proposal",
      prompt: buildDelegationPrompt({
        task: "Validate the primary experiment proposal under the single-change rule.",
        expectedOutcome: "Return JSON only with verdict, validity_risks, smallest_repair, and single_change_ok.",
        requiredTools: ["- experiment_status"],
        mustDo: [
          "Call experiment_status exactly once.",
          "Evaluate only the provided primary proposal.",
          "Return only valid JSON.",
        ],
        mustNotDo: [
          "Do not rewrite the proposal into a different one.",
          "Do not output markdown or prose outside JSON.",
        ],
        context: {
          workspace_root: input.workspaceRoot,
          primary_proposal: input.primaryProposal,
          backup_proposal: input.backupProposal,
        },
      }),
      schema: guardResponseSchema,
    });
    return { response: liveResult.parsed, sessionID: liveResult.sessionID, execution: { mode: "live", fallback_reason: null, raw_excerpt: liveResult.rawExcerpt } };
  } catch (error) {
    const fallback = await invokeValidityGuard({ ...input, runtime: undefined, toolContext: undefined });
    return {
      ...fallback,
      execution: {
        mode: "fallback",
        fallback_reason: error instanceof Error ? error.message : String(error),
        raw_excerpt: error instanceof SpecialistInvocationError ? error.rawExcerpt : null,
      },
    };
  }
}

async function invokeMutationWorker(input: {
  workspaceRoot: string;
  mutation: MutationRequest;
  runtime?: PluginInput;
  toolContext?: ToolContext;
}): Promise<{ response: z.infer<typeof mutationWorkerResponseSchema>; sessionID: string | null; execution: SpecialistExecutionMeta }> {
  if (!hasLiveRuntime(input.runtime, input.toolContext)) {
    const spec = (await readJson(getWorkspaceConfigPath(input.workspaceRoot), null)) as ExperimentSpec | null;
    if (!spec) {
      throw new Error("experiment spec missing for simulated mutation-worker");
    }
    const response = mutationWorkerResponseSchema.parse(
      await executeIteration({
        workspaceRoot: input.workspaceRoot,
        spec,
        mutation: input.mutation,
      }),
    );
    return {
      response,
      sessionID: null,
      execution: { mode: "fallback", fallback_reason: null, raw_excerpt: buildAuditExcerpt(response) },
    };
  }

  const liveRuntime = input.runtime as PluginInput;
  const liveToolContext = input.toolContext as ToolContext;
  try {
    const liveResult = await invokeSpecialistLive({
      runtime: liveRuntime,
      toolContext: liveToolContext,
      agent: SISYPHUS_JUNIOR_AGENT,
      description: "Execute one chosen primary hypothesis",
      prompt: buildDelegationPrompt({
        task: "As Sisyphus-Junior, execute exactly one governed experiment iteration using the provided mutation request.",
        expectedOutcome: "Return JSON only with run_id, baseline_metric, current_metric, status, next_primary_change, change_class, change_unit, touched_files, diff_summary, and monitor_state.",
        requiredTools: ["- experiment_execute_iteration"],
        mustDo: [
          "Call experiment_execute_iteration exactly once.",
          "Pass through the provided workspace_root and mutation request.",
          "Act only as the single code executor for the selected hypothesis.",
          "Return only valid JSON.",
        ],
        mustNotDo: [
          "Do not perform more than one mutation.",
          "Do not choose between hypotheses or ask other agents to code.",
          "Do not output markdown or explanation outside JSON.",
        ],
        context: {
          workspace_root: input.workspaceRoot,
          mutation: input.mutation,
        },
      }),
      schema: mutationWorkerResponseSchema,
    });
    return { response: liveResult.parsed, sessionID: liveResult.sessionID, execution: { mode: "live", fallback_reason: null, raw_excerpt: liveResult.rawExcerpt } };
  } catch (error) {
    const fallback = await invokeMutationWorker({ ...input, runtime: undefined, toolContext: undefined });
    return {
      ...fallback,
      execution: {
        mode: "fallback",
        fallback_reason: error instanceof Error ? error.message : String(error),
        raw_excerpt: error instanceof SpecialistInvocationError ? error.rawExcerpt : null,
      },
    };
  }
}

async function invokeWatcher(input: {
  workspaceRoot: string;
  runId: string;
  runtime?: PluginInput;
  toolContext?: ToolContext;
}): Promise<{ response: z.infer<typeof watcherResponseSchema>; sessionID: string | null; execution: SpecialistExecutionMeta }> {
  const monitor = await loadMonitorSummary(getRunEventsPath(input.workspaceRoot, input.runId));
  const response = watcherResponseSchema.parse({
    run_state: monitor.state,
    last_meaningful_event: monitor.last_event_type,
    checkpoint_available: monitor.checkpoint_available,
    metric_reported: monitor.metric_reported,
    monitor_summary: `Run ${input.runId} is ${monitor.state}.`,
  });
  return {
    response,
    sessionID: null,
    execution: { mode: "fallback", fallback_reason: null, raw_excerpt: buildAuditExcerpt(response) },
  };
}

async function invokeJudge(input: {
  baselineMetric: number;
  currentMetric: number;
  metricDirection: ExperimentSpec["metric_direction"];
  monitorState: string;
  runtime?: PluginInput;
  toolContext?: ToolContext;
}): Promise<{ response: z.infer<typeof judgeResponseSchema>; sessionID: string | null; execution: SpecialistExecutionMeta }> {
  const judge = decideIteration({
    baselineMetric: input.baselineMetric,
    currentMetric: input.currentMetric,
    metricDirection: input.metricDirection,
    monitorState: input.monitorState,
  });
  const response = judgeResponseSchema.parse({
    status: judge.status,
    reason: judge.reason,
    confidence_note: "Deterministic local decision based on current metric and monitor state.",
  });
  return {
    response,
    sessionID: null,
    execution: { mode: "fallback", fallback_reason: null, raw_excerpt: buildAuditExcerpt(response) },
  };
}

async function runSingleGovernedIteration(input: {
  workspaceRoot: string;
  spec: ExperimentSpec;
  iteration: number;
  baselineMetric: number;
  previousChangeClass: "hyperparameter" | "config_switch" | "module_swap";
  previousChangeUnit: string;
  runtime?: PluginInput;
  toolContext?: ToolContext;
}): Promise<{
  iteration: IterationResult;
  monitor: MonitorSummary;
  judge: { status: "keep" | "discard" | "crash" | "review"; reason: string };
  steps: OrchestrationStep[];
  chosenProposal: ProposalCandidate | null;
}> {
  const exploit = await invokeAnalyst({
    agent: "Apollo",
    workspaceRoot: input.workspaceRoot,
    baselineMetric: input.baselineMetric,
    previousChangeClass: input.previousChangeClass,
    previousChangeUnit: input.previousChangeUnit,
    iteration: input.iteration,
    runtime: input.runtime,
    toolContext: input.toolContext,
  });
  const divergence = await invokeAnalyst({
    agent: "Hermes",
    workspaceRoot: input.workspaceRoot,
    baselineMetric: input.baselineMetric,
    previousChangeClass: input.previousChangeClass,
    previousChangeUnit: input.previousChangeUnit,
    iteration: input.iteration,
    runtime: input.runtime,
    toolContext: input.toolContext,
  });
  const normalizedExploit = normalizeProposalCandidate({
    candidate: exploit.response.primary,
    fallbackClass: input.previousChangeClass,
    iteration: input.iteration,
  });
  const normalizedDivergence = normalizeProposalCandidate({
    candidate: divergence.response.primary,
    fallbackClass: nextChangeClass(input.previousChangeClass),
    iteration: input.iteration,
  });
  const guard = await invokeValidityGuard({
    workspaceRoot: input.workspaceRoot,
    primaryProposal: normalizedExploit,
    backupProposal: normalizedDivergence,
    runtime: input.runtime,
    toolContext: input.toolContext,
  });

  const exploitCard = toProposalCard(normalizedExploit, "gpt", "exploit");
  const divergenceCard = toProposalCard(normalizedDivergence, "gemini", "divergence");
  const guardCard: ProposalCard = proposalCardSchema.parse({
    proposal_id: createId("proposal"),
    model_family: "claude",
    role: "validity_guard",
    family: normalizedExploit.change_class,
    mechanism: guard.response.verdict === "approve" ? "approved proposal" : "vetoed proposal",
    paper_grounding: [],
    causal_metric_path: [],
    change_surface: normalizedExploit.change_class,
    change_unit: normalizedExploit.change_unit,
    target_metric: "primary_metric",
    expected_direction: "flat",
    confidence: 0.9,
    risk: "low",
    single_change_ok: guard.response.single_change_ok,
    abstain_reason: null,
    veto: guard.response.verdict === "veto",
  });
  const resolved = resolveProposalSet([exploitCard, guardCard, divergenceCard]);

  const steps: OrchestrationStep[] = [
    createStep("Apollo", "analysis", "completed", "generated the exploit proposal", {
      session_id: exploit.sessionID,
      execution_mode: exploit.execution.mode,
      fallback_reason: exploit.execution.fallback_reason,
      raw_excerpt: exploit.execution.raw_excerpt,
      change_unit: normalizedExploit.change_unit,
      change_class: normalizedExploit.change_class,
      confidence: normalizedExploit.confidence,
    }),
    createStep(
      "Athena",
      "analysis",
      guard.response.verdict === "veto" ? "blocked" : "completed",
      guard.response.verdict === "veto" ? "vetoed the exploit proposal" : "approved the exploit proposal",
      {
        session_id: guard.sessionID,
        execution_mode: guard.execution.mode,
        fallback_reason: guard.execution.fallback_reason,
        raw_excerpt: guard.execution.raw_excerpt,
        verdict: guard.response.verdict,
        validity_risks: guard.response.validity_risks,
        single_change_ok: guard.response.single_change_ok,
      },
    ),
    createStep("Hermes", "analysis", "completed", "generated the divergence backup proposal", {
      session_id: divergence.sessionID,
      execution_mode: divergence.execution.mode,
      fallback_reason: divergence.execution.fallback_reason,
      raw_excerpt: divergence.execution.raw_excerpt,
      change_unit: normalizedDivergence.change_unit,
      change_class: normalizedDivergence.change_class,
      confidence: normalizedDivergence.confidence,
    }),
  ];

  const chosenProposal =
    resolved.primary?.model_family === "gpt"
      ? normalizedExploit
      : resolved.primary?.model_family === "gemini"
        ? normalizedDivergence
        : null;
  const backupProposal =
    resolved.backup?.model_family === "gemini"
      ? normalizedDivergence
      : resolved.backup?.model_family === "gpt"
        ? normalizedExploit
        : null;

  if (!chosenProposal) {
    const blockedIteration: IterationResult = {
      run_id: createId("blocked_run"),
      baseline_metric: input.baselineMetric,
      current_metric: input.baselineMetric,
      status: "review",
      next_primary_change: null,
      change_class: input.previousChangeClass,
      change_unit: input.previousChangeUnit,
      touched_files: [],
      diff_summary: guard.response.smallest_repair ?? resolved.rationale,
      monitor_state: "stalled",
    };
    const monitor = {
      state: "stalled",
      last_event_type: null,
      checkpoint_available: false,
      metric_reported: false,
    } satisfies MonitorSummary;
    const judge = {
      status: "review" as const,
      reason: guard.response.smallest_repair ?? resolved.rationale,
    };
    steps.push(createStep(SISYPHUS_ORCHESTRATOR_AGENT, "control", "blocked", "no safe single change remained after guard evaluation", {
      rationale: guard.response.smallest_repair ?? resolved.rationale,
    }));
    steps.push(createStep("judge_result.py", "judge", "completed", "returned review because no valid proposal remained", judge));
    return { iteration: blockedIteration, monitor, judge, steps, chosenProposal: null };
  }

  const mutation = buildMutationRequestFromProposal(chosenProposal);
  const mutationResult = await invokeMutationWorker({
    workspaceRoot: input.workspaceRoot,
    mutation,
    runtime: input.runtime,
    toolContext: input.toolContext,
  });
  steps.push(
    createStep(
      "sisyphus-junior",
      "mutation",
      "completed",
      guard.response.verdict === "veto"
        ? "executed the divergence fallback mutation"
        : "executed the approved primary mutation",
      {
        session_id: mutationResult.sessionID,
        execution_mode: mutationResult.execution.mode,
        fallback_reason: mutationResult.execution.fallback_reason,
        raw_excerpt: mutationResult.execution.raw_excerpt,
        run_id: mutationResult.response.run_id,
        change_class: mutationResult.response.change_class,
        change_unit: mutationResult.response.change_unit,
        touched_files: mutationResult.response.touched_files,
      },
    ),
  );

  const watcher = await invokeWatcher({
    workspaceRoot: input.workspaceRoot,
    runId: mutationResult.response.run_id,
    runtime: input.runtime,
    toolContext: input.toolContext,
  });
  const monitor: MonitorSummary = {
    state: watcher.response.run_state === "failed" ? "failed" : watcher.response.run_state,
    last_event_type: watcher.response.last_meaningful_event as MonitorSummary["last_event_type"],
    checkpoint_available: watcher.response.checkpoint_available,
    metric_reported: watcher.response.metric_reported,
  };
  steps.push(createStep("status_poll.py", "monitor", "completed", `classified run ${mutationResult.response.run_id} as ${watcher.response.run_state}`, {
    session_id: watcher.sessionID,
    execution_mode: watcher.execution.mode,
    fallback_reason: watcher.execution.fallback_reason,
    raw_excerpt: watcher.execution.raw_excerpt,
    run_id: mutationResult.response.run_id,
    state: watcher.response.run_state,
    metric_reported: watcher.response.metric_reported,
  }));

  const judgeResult = await invokeJudge({
    baselineMetric: mutationResult.response.baseline_metric,
    currentMetric: mutationResult.response.current_metric,
    metricDirection: input.spec.metric_direction,
    monitorState: watcher.response.run_state,
    runtime: input.runtime,
    toolContext: input.toolContext,
  });
  const judge = {
    status: judgeResult.response.status,
    reason: judgeResult.response.reason,
  };
  steps.push(createStep("judge_result.py", "judge", "completed", `returned ${judge.status}`, {
    session_id: judgeResult.sessionID,
    execution_mode: judgeResult.execution.mode,
    fallback_reason: judgeResult.execution.fallback_reason,
    raw_excerpt: judgeResult.execution.raw_excerpt,
    run_id: mutationResult.response.run_id,
    status: judge.status,
    reason: judge.reason,
  }));

  return {
    iteration: {
      ...mutationResult.response,
      status: judge.status,
      monitor_state: monitor.state,
      next_primary_change: backupProposal?.change_unit ?? mutationResult.response.next_primary_change,
    },
    monitor,
    judge,
    steps,
    chosenProposal,
  };
}

export async function runLegacyGovernedExperimentWorkflow(input: {
  workspaceRoot: string;
  spec: ExperimentSpec;
  runtime?: PluginInput;
  toolContext?: ToolContext;
}): Promise<GovernedWorkflowSummary> {
  const workflowId = createId("workflow");
  const steps: OrchestrationStep[] = [];
  const priorSession = await loadSession(input.workspaceRoot);
  const shouldUsePrometheus = priorSession?.stage === "review_blocked";
  if (shouldUsePrometheus) {
    const resumeStep = await invokeRecoveryOperator({
      workspaceRoot: input.workspaceRoot,
      priorStage: priorSession?.stage ?? "idle",
      runtime: input.runtime,
      toolContext: input.toolContext,
    });
    const recoveryStep = createStep(PROMETHEUS_PLANNER_AGENT, "resume", "completed", `selected ${resumeStep.response.recovery_action}`, {
      session_id: resumeStep.sessionID,
      execution_mode: resumeStep.execution.mode,
      fallback_reason: resumeStep.execution.fallback_reason,
      raw_excerpt: resumeStep.execution.raw_excerpt,
      recovery_action: resumeStep.response.recovery_action,
      recovery_source: resumeStep.response.recovery_source,
      previous_stage: priorSession?.stage ?? "idle",
    });
    steps.push(recoveryStep);
    await appendStep(input.workspaceRoot, recoveryStep);
  }

  let baselineMetric = (await loadBestMetric(input.workspaceRoot)) ?? 0.5;
  let previousChangeClass: "hyperparameter" | "config_switch" | "module_swap" = "hyperparameter";
  let previousChangeUnit = "learning_rate";
  let noImprovementRounds = 0;
  let stopReason: string | null = null;
  let latestDecision: GovernedWorkflowResult["latest_decision"] = null;
  let activeRunId: string | null = null;

  for (let iteration = 1; iteration <= input.spec.max_iterations; iteration += 1) {
    const result = await runSingleGovernedIteration({
      workspaceRoot: input.workspaceRoot,
      spec: input.spec,
      iteration,
      baselineMetric,
      previousChangeClass,
      previousChangeUnit,
      runtime: input.runtime,
      toolContext: input.toolContext,
    });

    for (const step of result.steps) {
      steps.push(step);
      await appendStep(input.workspaceRoot, step);
    }

    latestDecision = result.judge.status;
    activeRunId = result.iteration.run_id ?? activeRunId;
    previousChangeClass = result.iteration.change_class;
    previousChangeUnit = result.chosenProposal?.change_unit ?? result.iteration.change_unit;

    const improved =
      input.spec.metric_direction === "maximize"
        ? result.iteration.current_metric > baselineMetric
        : result.iteration.current_metric < baselineMetric;

    if (improved && result.judge.status === "keep") {
      baselineMetric = result.iteration.current_metric;
      noImprovementRounds = 0;
    } else {
      noImprovementRounds += 1;
    }

    const sessionStage =
      result.judge.status === "review"
        ? "review_blocked"
        : result.judge.status === "crash"
          ? "crash_recoverable"
          : "running";
    const session = buildSession({
      workspaceRoot: input.workspaceRoot,
      stage: sessionStage,
      message: `workflow ${workflowId} iteration ${iteration} => ${result.judge.status}`,
      activeRunId,
      bestRunId: result.judge.status === "keep" ? activeRunId : priorSession?.best_run_id ?? null,
      stopReason,
      iterationCount: iteration,
    });
    await saveSession(input.workspaceRoot, session);

    const threshold = input.spec.stop_rule.metric_threshold;
    if (typeof threshold === "number") {
      const thresholdReached =
        input.spec.metric_direction === "maximize"
          ? baselineMetric >= threshold
          : baselineMetric <= threshold;
      if (thresholdReached) {
        stopReason = "goal_reached";
        break;
      }
    }

    if (result.judge.status === "review") {
      stopReason = "review_blocked";
      break;
    }

    if (result.judge.status === "crash") {
      stopReason = "crash_recoverable";
      break;
    }

    if (
      input.spec.stop_rule.max_no_improvement_rounds > 0 &&
      noImprovementRounds >= input.spec.stop_rule.max_no_improvement_rounds
    ) {
      stopReason = "stop_rule_triggered";
      break;
    }

    if (iteration === input.spec.max_iterations) {
      stopReason = "budget_exhausted";
    }
  }

  const bestMetric = await loadBestMetric(input.workspaceRoot);
  const specialistAudit: SpecialistAuditRecord[] = steps
    .filter((step) => Object.prototype.hasOwnProperty.call(step.payload, "session_id") || Object.prototype.hasOwnProperty.call(step.payload, "execution_mode"))
    .map((step) => ({
      actor: step.actor,
      phase: step.phase,
      session_id: (step.payload.session_id as string | null | undefined) ?? null,
      execution_mode: (step.payload.execution_mode as SpecialistAuditRecord["execution_mode"] | undefined) ?? null,
      fallback_reason: (step.payload.fallback_reason as string | null | undefined) ?? null,
      raw_excerpt: (step.payload.raw_excerpt as string | null | undefined) ?? null,
    }));

  const summary: GovernedWorkflowSummary = {
    workflow_id: workflowId,
    stop_reason: stopReason,
    total_iterations: (await readJsonl(getRunsPath(input.workspaceRoot))).length,
    best_metric: bestMetric,
    latest_decision: latestDecision,
    active_run_id: activeRunId,
    steps,
    specialist_audit: specialistAudit,
  };

  await writeJson(getOrchestrationSummaryPath(input.workspaceRoot), summary);
  await saveSession(
    input.workspaceRoot,
    buildSession({
      workspaceRoot: input.workspaceRoot,
      stage: stopReason === "review_blocked" ? "review_blocked" : stopReason === "crash_recoverable" ? "crash_recoverable" : "completed",
      message: `workflow ${workflowId} finished with ${stopReason ?? "running"}`,
      activeRunId,
      bestRunId: activeRunId,
      stopReason,
      iterationCount: summary.total_iterations,
    }),
  );

  return summary;
}

export const runGovernedExperimentWorkflow = runLegacyGovernedExperimentWorkflow;
