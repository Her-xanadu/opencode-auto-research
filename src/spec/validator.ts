import { experimentSpecSchema, type ExperimentSpec } from "./schema";

export interface ExperimentSpecValidationResult {
  valid: boolean;
  errors: string[];
  spec?: ExperimentSpec;
}

export function validateExperimentSpec(input: unknown): ExperimentSpecValidationResult {
  const parsed = experimentSpecSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "spec"}: ${issue.message}`),
    };
  }
  return { valid: true, errors: [], spec: parsed.data };
}
