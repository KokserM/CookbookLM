import { describe, expect, test } from "vitest";
import { buildInstructions, buildTranslateCacheIdentity, type TranslateInput } from "../ai_translate";
import { determineAiTask, selectModelForTask, shouldRunAi } from "../ai_routing";

function baseInput(overrides: Partial<TranslateInput> = {}): TranslateInput {
  return {
    taskType: "translate_only",
    model: "economy-model",
    apiKey: "test",
    source_url: "https://example.com/recipe",
    title_in: "Soup",
    ingredients_in: ["2 tbsp flour", "1 cup milk"],
    steps_in: ["Whisk flour into the sauce."],
    includeSubstitutions: false,
    activeAllergens: [],
    measurementPreference: "metric",
    targetLanguage: "en",
    allergenContext: [],
    ...overrides,
  };
}

describe("ai routing", () => {
  test("skips AI when language, substitutions, and allergens do not require it", () => {
    const taskType = determineAiTask({ translateNeeded: false, includeSubstitutions: false, activeAllergens: [] });

    expect(taskType).toBe("none");
    expect(shouldRunAi(taskType)).toBe(false);
  });

  test("uses economy model for translation-only in balanced mode", () => {
    const taskType = determineAiTask({ translateNeeded: true, includeSubstitutions: false, activeAllergens: [] });
    const model = selectModelForTask(taskType, {
      qualityModel: "quality-model",
      economyModel: "economy-model",
      modelRouting: "balanced",
    });

    expect(taskType).toBe("translate_only");
    expect(model).toBe("economy-model");
  });

  test("uses quality model for gluten allergen adaptation", () => {
    const taskType = determineAiTask({ translateNeeded: false, includeSubstitutions: false, activeAllergens: ["gluten"] });
    const model = selectModelForTask(taskType, {
      qualityModel: "quality-model",
      economyModel: "economy-model",
      modelRouting: "balanced",
    }, ["gluten"]);

    expect(taskType).toBe("allergen_adaptation");
    expect(model).toBe("quality-model");
  });

  test("allergen prompt contains realistic substitution and soy tamari safety rules", () => {
    const prompt = buildInstructions(baseInput({
      taskType: "allergen_adaptation",
      includeSubstitutions: true,
      activeAllergens: ["gluten", "soy"],
      allergenContext: ['{"idx":0,"ingredient":"2 tbsp flour","allergen":"gluten","role":"thickener","relevantSteps":[0]}'],
    }));

    expect(prompt).toContain("certified/labeled gluten-free");
    expect(prompt).toContain("never suggest tamari");
    expect(prompt).toContain("Do not suggest fantasy products");
    expect(prompt).toContain("slightly more liquid");
    expect(prompt).toContain("brown or burn faster");
    expect(prompt).toContain("xanthan gum");
    expect(prompt).toContain("psyllium husk");
  });

  test("translation-only prompt omits allergen context instructions", () => {
    const prompt = buildInstructions(baseInput());

    expect(prompt).not.toContain("ALLERGEN / DIETARY ADAPTATION MODE");
    expect(prompt).not.toContain("Local code provides detected risks");
  });

  test("cache identity differs by task type, model, allergens, and measurements", () => {
    const a = buildTranslateCacheIdentity(baseInput());
    const b = buildTranslateCacheIdentity(baseInput({
      taskType: "allergen_adaptation",
      model: "quality-model",
      activeAllergens: ["gluten"],
      measurementPreference: "imperial",
    }));

    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});
