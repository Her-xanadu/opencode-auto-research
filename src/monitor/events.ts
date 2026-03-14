import { z } from "zod";

export const runEventSchema = z.object({
  type: z.enum([
    "run_started",
    "heartbeat",
    "log_progress",
    "checkpoint_saved",
    "metric_reported",
    "run_completed",
    "run_failed",
    "resume_attempted",
    "resume_succeeded",
    "resume_failed",
  ]),
  run_id: z.string(),
  timestamp: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type RunEvent = z.infer<typeof runEventSchema>;
