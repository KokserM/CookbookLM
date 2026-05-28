import { describe, expect, test } from "vitest";
import { parseIngredientLine } from "../ingredient_parser";
import { convertParsedIngredientToSystemLine } from "../unit_converter";
import { buildAllergenContext, formatAllergenContextForPrompt, normalizeAllergenModes } from "../allergen_context";

describe("allergen_context", () => {
  test("normalizes legacy gluten flag", () => {
    expect(normalizeAllergenModes(undefined, true)).toContain("gluten");
  });

  test("detects gluten thickener context without producing substitutions", () => {
    const converted = [parseIngredientLine("2 tbsp flour")].map((p) => convertParsedIngredientToSystemLine(p, "source"));
    const context = buildAllergenContext(converted, ["gluten"], ["Whisk flour into sauce until thickened."]);
    expect(context[0]?.allergen).toBe("gluten");
    expect(context[0]?.idx).toBe(0);
    expect(context[0]?.role).toBe("thickener");
    expect(context[0]?.relevantSteps).toEqual([0]);
    expect(formatAllergenContextForPrompt(context)[0]).toContain("thickener");
  });

  test("separates soy allergy from gluten tamari guidance", () => {
    const converted = [parseIngredientLine("2 tbsp soy sauce")].map((p) => convertParsedIngredientToSystemLine(p, "source"));
    const context = buildAllergenContext(converted, ["soy"]);
    expect(context[0]?.allergen).toBe("soy");
    expect(context[0]?.guidance.toLowerCase()).toContain("do not suggest tamari");
  });

  test("detects multiple active allergens without inventing substitutions", () => {
    const converted = [
      parseIngredientLine("1 cup milk"),
      parseIngredientLine("2 eggs"),
      parseIngredientLine("1 tbsp sesame oil"),
    ].map((p) => convertParsedIngredientToSystemLine(p, "source"));

    const context = buildAllergenContext(converted, ["dairy", "egg", "sesame"]);

    expect(context.map((c) => c.allergen)).toEqual(["dairy", "egg", "sesame"]);
    expect(formatAllergenContextForPrompt(context).every((line) => line.startsWith("{"))).toBe(true);
  });

  test("includes gluten-free binder and browning guidance for breadcrumbs", () => {
    const converted = [parseIngredientLine("1 cup breadcrumbs")].map((p) => convertParsedIngredientToSystemLine(p, "source"));
    const context = buildAllergenContext(converted, ["gluten"], ["Shape the mixture into patties and fry until browned."]);

    expect(context.some((c) => c.role === "coating" || c.role === "binder/structure")).toBe(true);
    expect(context.map((c) => c.guidance).join(" ").toLowerCase()).toContain("faster browning");
    expect(context.map((c) => c.guidance).join(" ").toLowerCase()).toContain("psyllium");
  });
});
