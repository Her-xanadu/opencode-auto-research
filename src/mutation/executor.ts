import { z } from "zod";
import { applyConfigSwitch } from "./change-appliers/config-switch";
import { applyHyperparameterChange } from "./change-appliers/hyperparameter";
import { applyModuleSwap } from "./change-appliers/module-swap";

const normalizedMutationClassSchema = z.enum(["hyperparameter", "config_switch", "module_swap"]);

const mutationClassSchema = z.enum([
  "hyperparameter",
  "config_switch",
  "module_swap",
  "objective",
  "representation",
  "architecture",
]);

export const mutationRequestSchema = z.object({
  change_class: mutationClassSchema,
  change_unit: z.string().min(1),
  target_file: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
});

export type MutationRequest = {
  change_class: z.infer<typeof normalizedMutationClassSchema>;
  change_unit: string;
  target_file: string;
  params: Record<string, unknown>;
};

export interface MutationResult {
  change_manifest: {
    primary_object: string;
    secondary_objects: string[];
  };
  touched_files: string[];
  diff_summary: string;
}

function normalizeChangeClass(
  changeClass: z.infer<typeof mutationClassSchema>,
): "hyperparameter" | "config_switch" | "module_swap" {
  if (changeClass === "objective") {
    return "hyperparameter";
  }
  if (changeClass === "representation") {
    return "config_switch";
  }
  if (changeClass === "architecture") {
    return "module_swap";
  }
  return changeClass;
}

export async function executeMutation(executionRoot: string, request: MutationRequest): Promise<MutationResult> {
  const parsed = mutationRequestSchema.parse(request);
  const normalizedChangeClass = normalizeChangeClass(parsed.change_class);
  const normalizedRequest: MutationRequest = {
    change_class: normalizedChangeClass,
    change_unit: parsed.change_unit,
    target_file: parsed.target_file,
    params: parsed.params,
  };
  let applied: { touched_files: string[]; diff_summary: string };
  if (normalizedRequest.change_class === "hyperparameter") {
    applied = await applyHyperparameterChange(
      executionRoot,
      normalizedRequest.target_file,
      String(normalizedRequest.params.key ?? normalizedRequest.change_unit),
      normalizedRequest.params.value,
    );
  } else if (normalizedRequest.change_class === "config_switch") {
    applied = await applyConfigSwitch(
      executionRoot,
      normalizedRequest.target_file,
      String(normalizedRequest.params.search ?? "baseline"),
      String(normalizedRequest.params.replace ?? normalizedRequest.change_unit),
    );
  } else {
    applied = await applyModuleSwap(
      executionRoot,
      normalizedRequest.target_file,
      String(normalizedRequest.params.content ?? "export const replacement = true;\n"),
    );
  }
  return {
    change_manifest: {
      primary_object: normalizedRequest.change_unit,
      secondary_objects: [],
    },
    touched_files: applied.touched_files,
    diff_summary: applied.diff_summary,
  };
}
