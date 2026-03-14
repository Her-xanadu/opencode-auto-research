import { z } from "zod";

export const experimentSpecSchema = z.object({
  workspace_root: z.string().min(1),
  editable_paths: z.array(z.string()).min(1),
  read_only_paths: z.array(z.string()).default([]),
  eval_command: z.string().min(1),
  eval_parser: z.string().min(1),
  primary_metric: z.string().min(1),
  metric_direction: z.enum(["maximize", "minimize"]),
  max_iterations: z.number().int().positive(),
  max_hours: z.number().positive(),
  stop_rule: z.object({
    metric_threshold: z.number().optional(),
    max_no_improvement_rounds: z.number().int().nonnegative().default(0),
  }),
});

export type ExperimentSpec = z.infer<typeof experimentSpecSchema>;
