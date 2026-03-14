export interface IterationDecisionInput {
  baselineMetric: number;
  currentMetric: number | null;
  metricDirection: "maximize" | "minimize";
  monitorState: string;
}

export function decideIteration(input: IterationDecisionInput): { status: "keep" | "discard" | "crash" | "review"; reason: string } {
  if (input.monitorState === "failed") {
    return { status: "crash", reason: "run failed during monitoring" };
  }
  if (input.monitorState === "stalled") {
    return { status: "review", reason: "run stalled and needs review" };
  }
  if (input.currentMetric === null) {
    return { status: "crash", reason: "metric missing" };
  }
  const improved =
    input.metricDirection === "maximize"
      ? input.currentMetric > input.baselineMetric
      : input.currentMetric < input.baselineMetric;
  return improved ? { status: "keep", reason: "primary metric improved" } : { status: "discard", reason: "primary metric did not improve" };
}
