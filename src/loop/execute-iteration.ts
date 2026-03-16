import { appendJsonl, writeJson } from "../utils/fs";
import { getBestPath, getResultPacketPath, getRunEventsPath, getRunsPath } from "../utils/paths";
import { nowIso } from "../utils/time";
import type { ExperimentSpec } from "../spec/schema";
import { executeMutation, type MutationRequest } from "../mutation/executor";
import { runEvalCommand } from "./eval";
import { decideIteration } from "./decider";
import { runTriModelAnalysis } from "../analysis/tri-model";
import { aggregateProposals } from "../analysis/aggregator";
import type { MonitorState } from "../monitor/controller";

export interface IterationResult {
  run_id: string;
  baseline_metric: number;
  current_metric: number;
  status: "keep" | "discard" | "crash" | "review";
  next_primary_change: string | null;
  change_class: MutationRequest["change_class"];
  change_unit: string;
  touched_files: string[];
  diff_summary: string;
  monitor_state: MonitorState;
}

async function writeRunEvent(
  workspaceRoot: string,
  runId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const event = {
    type,
    run_id: runId,
    timestamp: nowIso(),
    payload,
  };
  await appendJsonl(getRunEventsPath(workspaceRoot, runId), event);
}

export async function executeIteration(input: {
  workspaceRoot: string;
  spec: ExperimentSpec;
  mutation: MutationRequest;
  baselineMetric?: number;
}): Promise<IterationResult> {
  const runId = `run-${Date.now()}`;
  const baselineMetric = input.baselineMetric ?? 0.5;
  await writeRunEvent(input.workspaceRoot, runId, "run_started", {
    baseline_metric: baselineMetric,
    change_class: input.mutation.change_class,
    change_unit: input.mutation.change_unit,
  });
  const mutationResult = await executeMutation(input.workspaceRoot, input.mutation);
  await writeRunEvent(input.workspaceRoot, runId, "log_progress", {
    touched_files: mutationResult.touched_files,
    diff_summary: mutationResult.diff_summary,
  });
  const currentMetric = await runEvalCommand(input.spec.eval_command, input.workspaceRoot, input.spec.eval_parser);
  await writeRunEvent(input.workspaceRoot, runId, "metric_reported", {
    metric: currentMetric,
  });
  const decision = decideIteration({
    baselineMetric,
    currentMetric,
    metricDirection: input.spec.metric_direction,
    monitorState: "completed",
  });
  await writeRunEvent(input.workspaceRoot, runId, "run_completed", {
    status: decision.status,
    metric: currentMetric,
  });
  const packet = {
    run_id: runId,
    baseline_metric: baselineMetric,
    current_metric: currentMetric,
    best_metric: Math.max(baselineMetric, currentMetric),
    metric_delta: currentMetric - baselineMetric,
    change_class: input.mutation.change_class,
    change_unit: input.mutation.change_unit,
    change_manifest: mutationResult.change_manifest,
    monitor_summary: { state: "completed" },
    decision_status: decision.status,
  };
  await writeJson(getResultPacketPath(input.workspaceRoot), packet);
  const proposals = runTriModelAnalysis(packet);
  const aggregate = aggregateProposals(proposals);
  const record = {
    run_id: runId,
    created_at: nowIso(),
    baseline_metric: baselineMetric,
    current_metric: currentMetric,
    change_manifest: mutationResult.change_manifest,
    touched_files: mutationResult.touched_files,
    diff_summary: mutationResult.diff_summary,
    status: decision.status,
  };
  await appendJsonl(getRunsPath(input.workspaceRoot), record);
  if (decision.status === "keep") {
    const best = {
      current_best: { run_id: runId, metric: currentMetric, commit: "local", checkpoint: null },
      candidate: null,
      parent_state: { run_id: runId, commit: "local" },
      updated_at: nowIso(),
    };
    await writeJson(getBestPath(input.workspaceRoot), best);
  }
  return {
    run_id: runId,
    baseline_metric: baselineMetric,
    current_metric: currentMetric,
    status: decision.status,
    next_primary_change:
      typeof aggregate.next_primary_change?.change_unit === "string"
        ? aggregate.next_primary_change.change_unit
        : null,
    change_class: input.mutation.change_class,
    change_unit: input.mutation.change_unit,
    touched_files: mutationResult.touched_files,
    diff_summary: mutationResult.diff_summary,
    monitor_state: "completed",
  };
}
