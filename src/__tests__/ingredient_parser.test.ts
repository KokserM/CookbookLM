import { describe, expect, test } from "vitest";
import { parseIngredientLine } from "../ingredient_parser";

describe("ingredient_parser", () => {
  test("parses mixed fractions", () => {
    const p = parseIngredientLine("1 1/2 cups flour");
    expect(p.parsed).toBe(true);
    expect(p.qty).toBeCloseTo(1.5);
    expect(p.unit).toBe("cup");
    expect(p.ingredient).toBe("flour");
  });

  test("parses unicode mixed fractions like 1 ¼", () => {
    const p = parseIngredientLine("1 ¼ cups half and half");
    expect(p.parsed).toBe(true);
    expect(p.qty).toBeCloseTo(1.25);
    expect(p.unit).toBe("cup");
  });

  test("parses ranges", () => {
    const p = parseIngredientLine("1–2 tbsp olive oil");
    expect(p.parsed).toBe(true);
    expect(p.isRange).toBe(true);
    expect(p.qty).toBeCloseTo(1);
    expect(p.qty2).toBeCloseTo(2);
    expect(p.unit).toBe("tbsp");
  });

  test("keeps unparsed lines", () => {
    const p = parseIngredientLine("Salt and pepper to taste");
    expect(p.parsed).toBe(false);
  });
});


