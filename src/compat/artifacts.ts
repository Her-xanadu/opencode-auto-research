import { writeText } from "../utils/fs";
import type { ExperimentSession } from "../experiment/session";
import type { ExperimentSpec } from "../spec/schema";
import {
  getCompatGoalPath,
} from "../utils/paths";

function yamlList(values: string[]): string {
  return values.map((value) => `  - ${value}`).join("\n");
}

export function renderGoalYaml(spec: ExperimentSpec): string {
  const lines = [
    `target_metric: ${spec.primary_metric}`,
    `metric_direction: ${spec.metric_direction}`,
    `target_threshold: ${spec.stop_rule.metric_threshold ?? ""}`,
    `max_rounds: ${spec.max_iterations}`,
    `max_hours: ${spec.max_hours}`,
    "editable_paths:",
    yamlList(spec.editable_paths),
    `eval_command: ${JSON.stringify(spec.eval_command)}`,
    `metric_extract_rule: ${spec.eval_parser}`,
  ];
  if (spec.read_only_paths.length > 0) {
    lines.push("read_only_paths:", yamlList(spec.read_only_paths));
  }
  return `${lines.join("\n")}\n`;
}

export async function syncGoalArtifact(workspaceRoot: string, spec: ExperimentSpec): Promise<void> {
  await writeText(getCompatGoalPath(workspaceRoot), renderGoalYaml(spec));
}

export async function syncSessionArtifact(workspaceRoot: string, session: ExperimentSession): Promise<void> {
  void workspaceRoot;
  void session;
}

export async function syncAttemptArtifact(workspaceRoot: string, record: unknown): Promise<void> {
  void workspaceRoot;
  void record;
}

export async function syncBestArtifact(workspaceRoot: string, best: unknown): Promise<void> {
  void workspaceRoot;
  void best;
}

export async function syncProposalCardArtifact(workspaceRoot: string, card: unknown): Promise<void> {
  void workspaceRoot;
  void card;
}

export async function syncRunEventArtifact(workspaceRoot: string, runId: string, event: unknown): Promise<void> {
  void workspaceRoot;
  void runId;
  void event;
}
