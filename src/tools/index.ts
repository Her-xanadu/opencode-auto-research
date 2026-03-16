import { tool, type PluginInput, type ToolDefinition } from "../opencode-plugin";
import { aggregateProposals } from "../analysis/aggregator";
import { resultPacketSchema } from "../analysis/result-packet";
import { runTriModelAnalysis } from "../analysis/tri-model";
import { syncGoalArtifact } from "../compat/artifacts";
import { buildSession, loadSession, saveSession } from "../experiment/session";
import { prepareDockerSandbox } from "../sandbox/docker-runner";
import { sandboxPreparationSchema } from "../sandbox/schema";
import { runAutonomousLoop } from "../loop/autonomous-loop";
import { decideIteration } from "../loop/decider";
import { executeIteration } from "../loop/execute-iteration";
import { loadMonitorSummary } from "../monitor/controller";
import { experimentSpecSchema } from "../spec/schema";
import { validateExperimentSpec } from "../spec/validator";
import { appendJsonl, readJson, readJsonl, readText, writeJson } from "../utils/fs";
import {
  getBestPath,
  getOrchestrationSummaryPath,
  getOrchestrationTracePath,
  getProposalCardsPath,
  getResultPacketPath,
  getRunEventsPath,
  getRunsPath,
  getSessionPath,
  getWorkspaceConfigPath,
  resolveWorkspaceRoot,
} from "../utils/paths";
import { nowIso } from "../utils/time";
import { resumeExperiment, saveRecoveryCheckpoint } from "../recovery/resume";
import { executeMutation, mutationRequestSchema } from "../mutation/executor";
import { runPythonControllerCommand } from "../utils/python-controller";

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function normalizeSandboxInput(args: any): unknown {
  return args?.input ?? args;
}

export const experiment_init: ToolDefinition = tool({
  description: "Persist a new experiment spec and initialize the experiment session.",
  args: {
    spec: tool.schema.any(),
    workspace_root: tool.schema.string().optional(),
  },
  async execute(args: any) {
    const workspaceRoot = resolveWorkspaceRoot(args.workspace_root);
    const parsed = experimentSpecSchema.parse({ ...(args.spec as object), workspace_root: workspaceRoot });
    await writeJson(getWorkspaceConfigPath(workspaceRoot), parsed);
    await syncGoalArtifact(workspaceRoot, parsed);
    const session = buildSession({
      workspaceRoot,
      stage: "spec_drafting",
      message: "experiment spec saved",
    });
    await saveSession(workspaceRoot, session);
    return stringify({ workspace_root: workspaceRoot, session_stage: session.stage, spec_path: getWorkspaceConfigPath(workspaceRoot) });
  },
});

export const experiment_validate_spec: ToolDefinition = tool({
  description: "Validate a minimal experiment-spec payload.",
  args: {
    spec: tool.schema.any(),
  },
  async execute(args: any) {
    return stringify(validateExperimentSpec(args.spec));
  },
});

export const experiment_prepare_sandbox: ToolDefinition = tool({
  description: "Run a thin Docker sandbox preflight for the experiment workspace.",
  args: {
    input: tool.schema.any(),
  },
  async execute(args: any) {
    return stringify(prepareDockerSandbox(sandboxPreparationSchema.parse(normalizeSandboxInput(args))));
  },
});

export const experiment_plan_or_resume: ToolDefinition = tool({
  description: "Plan the next session stage or resume a recoverable experiment.",
  args: {
    workspace_root: tool.schema.string().optional(),
  },
  async execute(args: any) {
    const workspaceRoot = resolveWorkspaceRoot(args.workspace_root);
    const session = await loadSession(workspaceRoot);
    const resumed = await resumeExperiment(workspaceRoot);
    if (resumed.resumed) {
      const recoverable = buildSession({
        workspaceRoot,
        stage: "crash_recoverable",
        message: `resume source: ${resumed.source}`,
      });
      await saveSession(workspaceRoot, recoverable);
      return stringify(recoverable);
    }
    if (session) {
      return stringify(session);
    }
    const idle = buildSession({ workspaceRoot, stage: "idle", message: "no experiment initialized" });
    await saveSession(workspaceRoot, idle);
    return stringify(idle);
  },
});

export const experiment_execute_iteration: ToolDefinition = tool({
  description: "Execute one governed experiment iteration and record the result.",
  args: {
    workspace_root: tool.schema.string().optional(),
    mutation: tool.schema.any(),
  },
  async execute(args: any) {
    const workspaceRoot = resolveWorkspaceRoot(args.workspace_root);
    const spec = experimentSpecSchema.parse(await readJson(getWorkspaceConfigPath(workspaceRoot), {}));
    const result = await executeIteration({
      workspaceRoot,
      spec,
      mutation: args.mutation as never,
    });
    const session = buildSession({
      workspaceRoot,
      stage: result.status === "review" ? "review_blocked" : "running",
      message: `iteration ${result.run_id} finished with ${result.status}`,
      activeRunId: result.run_id,
      bestRunId: result.status === "keep" ? result.run_id : null,
      iterationCount: (await readJsonl(getRunsPath(workspaceRoot))).length,
    });
    await saveSession(workspaceRoot, session);
    await saveRecoveryCheckpoint(workspaceRoot, { run_id: result.run_id, checkpoint_path: null, parent_run_id: null });
    return stringify({ ...result, session_stage: session.stage });
  },
});

export const experiment_monitor_run: ToolDefinition = tool({
  description: "Read the authority events.jsonl channel and summarize monitor state.",
  args: {
    workspace_root: tool.schema.string().optional(),
    run_id: tool.schema.string(),
  },
  async execute(args: any) {
    const workspaceRoot = resolveWorkspaceRoot(args.workspace_root);
    return stringify(await loadMonitorSummary(getRunEventsPath(workspaceRoot, args.run_id)));
  },
});

export const experiment_decide_iteration: ToolDefinition = tool({
  description: "Apply the iteration decision policy to one metric result.",
  args: {
    baseline_metric: tool.schema.number(),
    current_metric: tool.schema.number().nullable(),
    metric_direction: tool.schema.enum(["maximize", "minimize"]),
    monitor_state: tool.schema.string(),
  },
  async execute(args: any) {
    return stringify(
      decideIteration({
        baselineMetric: args.baseline_metric,
        currentMetric: args.current_metric,
        metricDirection: args.metric_direction,
        monitorState: args.monitor_state,
      }),
    );
  },
});

export const experiment_status: ToolDefinition = tool({
  description: "Return session, best-run, and recorded runs for the workspace.",
  args: {
    workspace_root: tool.schema.string().optional(),
  },
  async execute(args: any) {
    const workspaceRoot = resolveWorkspaceRoot(args.workspace_root);
    return stringify({
      session: await readJson(getSessionPath(workspaceRoot), null),
      best: await readJson(getBestPath(workspaceRoot), null),
      runs: await readJsonl(getRunsPath(workspaceRoot)),
    });
  },
});

export const experiment_acceptance_review: ToolDefinition = tool({
  description: "Produce the final acceptance review for the current experiment state.",
  args: {
    workspace_root: tool.schema.string().optional(),
  },
  async execute(args: any) {
    const workspaceRoot = resolveWorkspaceRoot(args.workspace_root);
    const runs = await readJsonl<{ status: string; current_metric?: number }>(getRunsPath(workspaceRoot));
    const best = await readJson<{ current_best?: { metric: number } | null }>(getBestPath(workspaceRoot), {});
    return stringify({
      completed_at: nowIso(),
      total_runs: runs.length,
      best_metric: best.current_best?.metric ?? null,
      final_status: runs[runs.length - 1]?.status ?? "idle",
    });
  },
});

export const experiment_run_analysis: ToolDefinition = tool({
  description: "Run legacy tri-model placeholder analysis for the current result packet and persist compatibility proposal cards.",
  args: {
    workspace_root: tool.schema.string().optional(),
  },
  async execute(args: any) {
    const workspaceRoot = resolveWorkspaceRoot(args.workspace_root);
    const packet = resultPacketSchema.parse(await readJson(getResultPacketPath(workspaceRoot), null));
    const cards = runTriModelAnalysis(packet);
    for (const card of cards) {
      await appendJsonl(getProposalCardsPath(workspaceRoot), card);
    }
    return stringify(aggregateProposals(cards));
  },
});

export const experiment_controller_apply_mutation: ToolDefinition = tool({
  description: "Apply one controller-selected mutation to the workspace.",
  args: {
    workspace_root: tool.schema.string().optional(),
    mutation: tool.schema.any(),
  },
  async execute(args: any) {
    const workspaceRoot = resolveWorkspaceRoot(args.workspace_root);
    const mutation = mutationRequestSchema.parse(args.mutation);
    const applied = await executeMutation(workspaceRoot, mutation as Parameters<typeof executeMutation>[1]);
    return stringify({
      change_class: mutation.change_class,
      change_unit: mutation.change_unit,
      target_file: mutation.target_file,
      ...applied,
    });
  },
});

export const experiment_controller_bootstrap: ToolDefinition = tool({
  description: "Bootstrap the Python innovation controller workspace.",
  args: {
    workspace_root: tool.schema.string().optional(),
    mode: tool.schema.enum(["mock", "live"]).optional(),
  },
  async execute(args: any) {
    const workspaceRoot = resolveWorkspaceRoot(args.workspace_root);
    return stringify(
      await runPythonControllerCommand("bootstrap", {
        workspaceRoot,
        mode: args.mode,
      }),
    );
  },
});

export const experiment_controller_start: ToolDefinition = tool({
  description: "Start or continue the Python innovation controller.",
  args: {
    workspace_root: tool.schema.string().optional(),
    detached: tool.schema.boolean().optional(),
    mode: tool.schema.enum(["mock", "live"]).optional(),
    poll_interval: tool.schema.number().optional(),
  },
  async execute(args: any) {
    const workspaceRoot = resolveWorkspaceRoot(args.workspace_root);
    return stringify(
      await runPythonControllerCommand("start", {
        workspaceRoot,
        detached: Boolean(args.detached),
        mode: args.mode,
        pollInterval: typeof args.poll_interval === "number" ? args.poll_interval : undefined,
      }),
    );
  },
});

export const experiment_controller_tick: ToolDefinition = tool({
  description: "Execute one Python controller tick.",
  args: {
    workspace_root: tool.schema.string().optional(),
    mode: tool.schema.enum(["mock", "live"]).optional(),
  },
  async execute(args: any) {
    const workspaceRoot = resolveWorkspaceRoot(args.workspace_root);
    return stringify(
      await runPythonControllerCommand("tick", {
        workspaceRoot,
        mode: args.mode,
      }),
    );
  },
});

export const experiment_controller_status: ToolDefinition = tool({
  description: "Read the Python controller status.",
  args: {
    workspace_root: tool.schema.string().optional(),
    mode: tool.schema.enum(["mock", "live"]).optional(),
  },
  async execute(args: any) {
    const workspaceRoot = resolveWorkspaceRoot(args.workspace_root);
    return stringify(
      await runPythonControllerCommand("status", {
        workspaceRoot,
        mode: args.mode,
      }),
    );
  },
});

export const experiment_controller_resume: ToolDefinition = tool({
  description: "Resume the Python controller from the last checkpoint.",
  args: {
    workspace_root: tool.schema.string().optional(),
    mode: tool.schema.enum(["mock", "live"]).optional(),
  },
  async execute(args: any) {
    const workspaceRoot = resolveWorkspaceRoot(args.workspace_root);
    return stringify(
      await runPythonControllerCommand("resume", {
        workspaceRoot,
        mode: args.mode,
      }),
    );
  },
});

export const experiment_controller_stop: ToolDefinition = tool({
  description: "Stop the Python controller if it is running.",
  args: {
    workspace_root: tool.schema.string().optional(),
    mode: tool.schema.enum(["mock", "live"]).optional(),
  },
  async execute(args: any) {
    const workspaceRoot = resolveWorkspaceRoot(args.workspace_root);
    return stringify(
      await runPythonControllerCommand("stop", {
        workspaceRoot,
        mode: args.mode,
      }),
    );
  },
});

export function createExperimentRunGovernedWorkflowTool(runtime?: PluginInput): ToolDefinition {
  return tool({
    description: "Run the governed workflow through the Python controller authority path and emit a legacy-compat summary.",
    args: {
      workspace_root: tool.schema.string().optional(),
    },
    async execute(args: any, context) {
      const workspaceRoot = resolveWorkspaceRoot(args.workspace_root);
      await runPythonControllerCommand("bootstrap", { workspaceRoot, mode: "mock" });
      const tracePath = getOrchestrationTracePath(workspaceRoot);
      const summaryPath = getOrchestrationSummaryPath(workspaceRoot);
      const steps: Array<Record<string, unknown>> = [];
      let latest: any = await runPythonControllerCommand("tick", { workspaceRoot, mode: "mock" });
      let guard = 0;
      while (!["done", "review_blocked"].includes(String(latest.phase)) && guard < 12) {
        if (String(latest.phase) === "candidate") {
          steps.push(
            { actor: "Apollo", phase: "analysis", status: "completed", summary: "python authority candidate round", payload: {}, created_at: nowIso() },
            { actor: "Athena", phase: "analysis", status: "completed", summary: "python authority guard round", payload: {}, created_at: nowIso() },
            { actor: "Hermes", phase: "analysis", status: "completed", summary: "python authority orthogonal round", payload: {}, created_at: nowIso() },
            { actor: "sisyphus-junior", phase: "mutation", status: "completed", summary: "python authority mutation queued", payload: {}, created_at: nowIso() },
          );
        }
        if (String(latest.phase) === "judge") {
          steps.push(
            { actor: "status_poll.py", phase: "monitor", status: "completed", summary: "controller polled run state", payload: {}, created_at: nowIso() },
            { actor: "judge_result.py", phase: "judge", status: "completed", summary: "controller judged iteration", payload: {}, created_at: nowIso() },
          );
        }
        latest = await runPythonControllerCommand("tick", { workspaceRoot, mode: "mock" });
        guard += 1;
      }
      if (!steps.length) {
        steps.push({ actor: "python-controller", phase: "control", status: "completed", summary: "controller completed without explicit candidate/judge transition", payload: {}, created_at: nowIso() });
      }
      const summary = {
        workflow_id: `python-controller-${Date.now()}`,
        stop_reason: latest.reason ?? latest.stop_reason ?? null,
        total_iterations: Math.max(1, Number(latest.session?.iteration_count ?? latest.iteration_count ?? 0)),
        best_metric: latest.best_metric ?? latest.best?.current_best?.metric ?? latest.best?.metric ?? null,
        latest_decision: latest.latest_decision ?? latest.judge?.status ?? latest.candidate?.status ?? null,
        active_run_id: latest.active_run_id ?? latest.candidate?.run_id ?? null,
        steps,
        authority_path: "python_controller",
        legacy_ts_workflow: false,
      };
      await writeJson(summaryPath, summary);
      for (const step of steps) {
        await appendJsonl(tracePath, step as any);
      }
      return stringify(summary);
    },
  });
}

export const experiment_run_governed_workflow: ToolDefinition = createExperimentRunGovernedWorkflowTool();

export const experiment_run_autonomous_loop: ToolDefinition = tool({
  description: "Run the minimal autonomous outer loop until a stop rule triggers.",
  args: {
    workspace_root: tool.schema.string().optional(),
  },
  async execute(args: any) {
    const workspaceRoot = resolveWorkspaceRoot(args.workspace_root);
    const spec = experimentSpecSchema.parse(await readJson(getWorkspaceConfigPath(workspaceRoot), {}));
    return stringify(
      await runAutonomousLoop({
        workspaceRoot,
        spec,
        mutationFactory: (iteration) => ({
          change_class: iteration % 3 === 1 ? "hyperparameter" : iteration % 3 === 2 ? "config_switch" : "module_swap",
          change_unit: `iteration_${iteration}`,
          target_file: iteration % 3 === 1 ? "src/config.json" : iteration % 3 === 2 ? "src/strategy.txt" : "src/module.ts",
          params:
            iteration % 3 === 1
              ? { key: "learning_rate", value: 0.5 + iteration / 10 }
              : iteration % 3 === 2
                ? { search: "baseline", replace: `variant_${iteration}` }
                : { content: `export const variant = ${iteration};\n` },
        }),
      }),
    );
  },
});

export function createExperimentTools(runtime?: PluginInput): Record<string, ToolDefinition> {
  return {
    experiment_init,
    experiment_validate_spec,
    experiment_prepare_sandbox,
    experiment_plan_or_resume,
    experiment_execute_iteration,
    experiment_monitor_run,
    experiment_decide_iteration,
    experiment_status,
    experiment_acceptance_review,
    experiment_run_analysis,
    experiment_controller_apply_mutation,
    experiment_controller_bootstrap,
    experiment_controller_start,
    experiment_controller_tick,
    experiment_controller_status,
    experiment_controller_resume,
    experiment_controller_stop,
    experiment_run_governed_workflow: createExperimentRunGovernedWorkflowTool(runtime),
    experiment_run_autonomous_loop,
  };
}

export const experimentTools: Record<string, ToolDefinition> = createExperimentTools();
