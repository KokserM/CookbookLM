import { describe, expect, test } from "vitest";
import { parseIngredientLine } from "../ingredient_parser";
import { convertParsedIngredientToMetricEn } from "../unit_converter";
import { applyGlutenFreeDeterministicSubstitutions } from "../gluten";

describe("gluten", () => {
  test("detects flour and suggests GF substitution", () => {
    const parsed = [parseIngredientLine("2 cups all-purpose flour")].map(convertParsedIngredientToMetricEn);
    const out = applyGlutenFreeDeterministicSubstitutions(parsed as any, true);
    expect(out.substitutions.length).toBeGreaterThan(0);
    expect(out.substitutions[0].suggestions_et.join(" ").toLowerCase()).toContain("gluteen");
  });
});


