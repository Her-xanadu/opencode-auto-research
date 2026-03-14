import { readJsonl } from "../utils/fs";
import { getRunsPath } from "../utils/paths";
import type { ExperimentSpec } from "../spec/schema";
import type { MutationRequest } from "../mutation/executor";
import { executeIteration } from "./execute-iteration";

export async function runAutonomousLoop(input: {
  workspaceRoot: string;
  spec: ExperimentSpec;
  mutationFactory: (iteration: number) => MutationRequest;
}) {
  let baseline = 0.5;
  let stopReason: string | null = null;
  for (let iteration = 1; iteration <= input.spec.max_iterations; iteration += 1) {
    const result = await executeIteration({
      workspaceRoot: input.workspaceRoot,
      spec: input.spec,
      mutation: input.mutationFactory(iteration),
      baselineMetric: baseline,
    });
    if (result.status === "keep") {
      baseline = result.current_metric;
    }
    const delta = Math.abs(result.current_metric - result.baseline_metric);
    const threshold = input.spec.stop_rule.metric_threshold;
    if (typeof threshold === "number") {
      const reached = input.spec.metric_direction === "maximize" ? result.current_metric >= threshold : result.current_metric <= threshold;
      if (reached) {
        stopReason = "goal_reached";
        break;
      }
    }
    if (iteration >= input.spec.max_iterations) {
      stopReason = "budget_exhausted";
    }
    if (result.status === "review") {
      stopReason = "review_blocked";
      break;
    }
    if (input.spec.stop_rule.max_no_improvement_rounds === 0 && delta === 0) {
      stopReason = "stop_rule_triggered";
      break;
    }
  }
  return {
    stop_reason: stopReason,
    runs: await readJsonl(getRunsPath(input.workspaceRoot)),
  };
}
