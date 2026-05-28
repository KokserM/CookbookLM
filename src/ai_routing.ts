import type { AiTaskType, AllergenId, ModelRoutingMode } from "./shared_types";

export type AiRoutingInput = {
  translateNeeded: boolean;
  includeSubstitutions: boolean;
  activeAllergens: AllergenId[];
};

export type ModelRoutingSettings = {
  qualityModel: string;
  economyModel: string;
  modelRouting: ModelRoutingMode;
};

const HIGH_RISK_ALLERGENS = new Set<AllergenId>(["gluten", "egg", "peanut", "treeNut", "soy", "fish", "shellfish", "sesame"]);

export function determineAiTask(input: AiRoutingInput): AiTaskType {
  if (input.activeAllergens.length) return "allergen_adaptation";
  if (input.includeSubstitutions) return "substitution_general";
  if (input.translateNeeded) return "translate_only";
  return "none";
}

export function hasHighRiskAllergen(activeAllergens: AllergenId[]): boolean {
  return activeAllergens.some((a) => HIGH_RISK_ALLERGENS.has(a));
}

export function selectModelForTask(taskType: AiTaskType, settings: ModelRoutingSettings, activeAllergens: AllergenId[] = []): string {
  if (settings.modelRouting === "best_quality") return settings.qualityModel;
  if (taskType === "allergen_adaptation") return settings.qualityModel;
  if (taskType === "validation_only" && hasHighRiskAllergen(activeAllergens) && settings.modelRouting !== "lowest_cost") {
    return settings.qualityModel;
  }
  return settings.economyModel || settings.qualityModel;
}

export function shouldRunAi(taskType: AiTaskType): boolean {
  return taskType !== "none";
}

export function shouldRunValidationPass(taskType: AiTaskType, activeAllergens: AllergenId[], substitutionCount: number): boolean {
  return taskType === "allergen_adaptation" && substitutionCount > 0 && hasHighRiskAllergen(activeAllergens);
}
