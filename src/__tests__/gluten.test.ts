import { describe, expect, test } from "vitest";
import { parseIngredientLine } from "../ingredient_parser";
import { convertParsedIngredientToMetricEn } from "../unit_converter";
import { applyGlutenFreeDeterministicSubstitutions, postProcessStepsForGlutenFreeTechniques } from "../gluten";

describe("gluten", () => {
  test("detects flour and suggests GF substitution", () => {
    const parsed = [parseIngredientLine("2 cups all-purpose flour")].map(convertParsedIngredientToMetricEn);
    const out = applyGlutenFreeDeterministicSubstitutions(parsed as any, true);
    expect(out.substitutions.length).toBeGreaterThan(0);
    expect(out.substitutions[0]!.suggestions_et.join(" ").toLowerCase()).toContain("gluteen");
  });

  test("adds thickener-specific note for small flour amounts", () => {
    const parsed = [parseIngredientLine("2 tbsp flour")].map(convertParsedIngredientToMetricEn);
    const out = applyGlutenFreeDeterministicSubstitutions(parsed as any, true);
    expect(out.substitutions[0]!.suggestions_et.join(" ").toLowerCase()).toContain("maisitärklis");
    expect(out.substitutions[0]!.note_et?.toLowerCase()).toContain("külma veega");
  });

  test("adds hidden-gluten sauce substitutions for soy sauce", () => {
    const parsed = [parseIngredientLine("2 tbsp soy sauce")].map(convertParsedIngredientToMetricEn);
    const out = applyGlutenFreeDeterministicSubstitutions(parsed as any, true);
    expect(out.substitutions[0]!.suggestions_et.join(" ").toLowerCase()).toContain("tamari");
    expect(out.substitutions[0]!.note_et?.toLowerCase()).toContain("märgistust");
  });

  test("injects gluten-free thickening instruction into sauce steps", () => {
    const parsed = [parseIngredientLine("2 tbsp flour")].map(convertParsedIngredientToMetricEn);
    const steps = postProcessStepsForGlutenFreeTechniques(
      ["Whisk the flour into the sauce and cook until thickened."],
      parsed as any,
      "en",
      true,
    );
    expect(steps[0]!.toLowerCase()).toContain("cornstarch");
    expect(steps[0]!.toLowerCase()).toContain("cold water");
  });
});


