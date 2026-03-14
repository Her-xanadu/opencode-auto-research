import { homedir } from "node:os";
import path from "node:path";

export const GLOBAL_CONFIG_PATH = path.join(homedir(), ".config", "opencode", "opencode-auto-experiment.json");

export function getExperimentRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".opencode", "auto-experiment");
}

export function getCompatConfigDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, "configs");
}

export function getCompatGoalPath(workspaceRoot: string): string {
  return path.join(getCompatConfigDir(workspaceRoot), "goal.yaml");
}

export function getCompatExperimentsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, "experiments");
}

export function getCompatSessionPath(workspaceRoot: string): string {
  return path.join(getCompatExperimentsDir(workspaceRoot), "session.json");
}

export function getCompatAttemptsPath(workspaceRoot: string): string {
  return path.join(getCompatExperimentsDir(workspaceRoot), "attempts.jsonl");
}

export function getCompatBestPath(workspaceRoot: string): string {
  return path.join(getCompatExperimentsDir(workspaceRoot), "best.json");
}

export function getCompatResultPacketPath(workspaceRoot: string): string {
  return path.join(getCompatExperimentsDir(workspaceRoot), "result_packet.json");
}

export function getCompatProposalCardsPath(workspaceRoot: string): string {
  return path.join(getCompatExperimentsDir(workspaceRoot), "proposal_cards.jsonl");
}

export function getCompatRunsDir(workspaceRoot: string): string {
  return path.join(getCompatExperimentsDir(workspaceRoot), "runs");
}

export function getCompatRunDir(workspaceRoot: string, runId: string): string {
  return path.join(getCompatRunsDir(workspaceRoot), runId);
}

export function getCompatRunEventsPath(workspaceRoot: string, runId: string): string {
  return path.join(getCompatRunDir(workspaceRoot, runId), "events.jsonl");
}

export function getWorkspaceConfigPath(workspaceRoot: string): string {
  return path.join(getExperimentRoot(workspaceRoot), "experiment-spec.json");
}

export function getSessionPath(workspaceRoot: string): string {
  return path.join(getExperimentRoot(workspaceRoot), "session.json");
}

export function getRunsPath(workspaceRoot: string): string {
  return path.join(getExperimentRoot(workspaceRoot), "runs.jsonl");
}

export function getBestPath(workspaceRoot: string): string {
  return path.join(getExperimentRoot(workspaceRoot), "best.json");
}

export function getAnalysisDir(workspaceRoot: string): string {
  return path.join(getExperimentRoot(workspaceRoot), "analysis");
}

export function getOrchestrationDir(workspaceRoot: string): string {
  return path.join(getExperimentRoot(workspaceRoot), "orchestration");
}

export function getResultPacketPath(workspaceRoot: string): string {
  return path.join(getAnalysisDir(workspaceRoot), "result-packet.json");
}

export function getProposalCardsPath(workspaceRoot: string): string {
  return path.join(getAnalysisDir(workspaceRoot), "proposal-cards.jsonl");
}

export function getOrchestrationTracePath(workspaceRoot: string): string {
  return path.join(getOrchestrationDir(workspaceRoot), "steps.jsonl");
}

export function getOrchestrationSummaryPath(workspaceRoot: string): string {
  return path.join(getOrchestrationDir(workspaceRoot), "summary.json");
}

export function getRunsDir(workspaceRoot: string): string {
  return path.join(getExperimentRoot(workspaceRoot), "runs");
}

export function getRunDir(workspaceRoot: string, runId: string): string {
  return path.join(getRunsDir(workspaceRoot), runId);
}

export function getRunEventsPath(workspaceRoot: string, runId: string): string {
  return path.join(getRunDir(workspaceRoot, runId), "events.jsonl");
}

export function getRecoveryJournalPath(workspaceRoot: string): string {
  return path.join(getExperimentRoot(workspaceRoot), "recovery-journal.jsonl");
}

export function getRecoveryCheckpointPath(workspaceRoot: string): string {
  return path.join(getExperimentRoot(workspaceRoot), "recovery-checkpoint.json");
}

export function resolveWorkspaceRoot(workspaceRoot?: string): string {
  return workspaceRoot ?? process.cwd();
}
