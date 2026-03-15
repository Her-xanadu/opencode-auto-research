import { z } from "zod";
export { controllerResearchContextSchema, controllerSessionSchema } from "../controller/schema";

export const resultPacketSchema = z.object({
  run_id: z.string(),
  baseline_metric: z.number(),
  current_metric: z.number(),
  best_metric: z.number(),
  metric_delta: z.number(),
  change_class: z.string(),
  change_unit: z.string(),
  change_manifest: z.object({
    primary_object: z.string(),
    secondary_objects: z.array(z.string()).default([]),
  }),
  monitor_summary: z.object({
    state: z.string(),
  }),
  decision_status: z.enum(["keep", "discard", "crash", "review"]),
});

export type ResultPacket = z.infer<typeof resultPacketSchema>;
