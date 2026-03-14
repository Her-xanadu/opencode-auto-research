import { z } from "zod";

export const sandboxPreparationSchema = z.object({
  workspace_root: z.string().min(1),
  editable_paths: z.array(z.string()).min(1),
  read_only_paths: z.array(z.string()).default([]),
  allowed_runtime_outputs: z.array(z.string()).default([]),
  sample_write_path: z.string().optional(),
});

export type SandboxPreparationInput = z.infer<typeof sandboxPreparationSchema>;
