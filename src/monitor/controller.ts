import { readJsonl } from "../utils/fs";
import { runEventSchema, type RunEvent } from "./events";

export type MonitorState = "running" | "stalled" | "failed" | "completed" | "recoverable";

export interface MonitorSummary {
  state: MonitorState;
  last_event_type: RunEvent["type"] | null;
  checkpoint_available: boolean;
  metric_reported: boolean;
}

export function summarizeEvents(events: RunEvent[], inactivityTimeoutMs = 30 * 60 * 1000): MonitorSummary {
  if (events.length === 0) {
    return { state: "stalled", last_event_type: null, checkpoint_available: false, metric_reported: false };
  }
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const last = sorted[sorted.length - 1];
  const checkpointAvailable = sorted.some((event) => event.type === "checkpoint_saved");
  const metricReported = sorted.some((event) => event.type === "metric_reported");
  if (last.type === "run_failed") {
    return {
      state: checkpointAvailable ? "recoverable" : "failed",
      last_event_type: last.type,
      checkpoint_available: checkpointAvailable,
      metric_reported: metricReported,
    };
  }
  if (last.type === "run_completed" && metricReported) {
    return { state: "completed", last_event_type: last.type, checkpoint_available: checkpointAvailable, metric_reported: metricReported };
  }
  const lastProgress = [...sorted]
    .reverse()
    .find((event) => ["heartbeat", "log_progress", "checkpoint_saved"].includes(event.type));
  const progressEvents = sorted.filter((event) => ["heartbeat", "log_progress", "checkpoint_saved"].includes(event.type));
  if (!lastProgress) {
    return { state: "stalled", last_event_type: last.type, checkpoint_available: checkpointAvailable, metric_reported: metricReported };
  }
  const idleMs = Date.parse(last.timestamp) - Date.parse(lastProgress.timestamp);
  const progressGapMs =
    progressEvents.length >= 2
      ? Date.parse(progressEvents[progressEvents.length - 1].timestamp) - Date.parse(progressEvents[progressEvents.length - 2].timestamp)
      : 0;
  if (idleMs > inactivityTimeoutMs || progressGapMs > inactivityTimeoutMs) {
    return { state: "stalled", last_event_type: last.type, checkpoint_available: checkpointAvailable, metric_reported: metricReported };
  }
  return { state: "running", last_event_type: last.type, checkpoint_available: checkpointAvailable, metric_reported: metricReported };
}

export async function loadMonitorSummary(eventsPath: string, inactivityTimeoutMs?: number): Promise<MonitorSummary> {
  const events = (await readJsonl<RunEvent>(eventsPath)).map((event) => runEventSchema.parse(event));
  return summarizeEvents(events, inactivityTimeoutMs);
}
