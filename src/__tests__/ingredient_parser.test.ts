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

  test("parses parenthetical package sizes into notes", () => {
    const p = parseIngredientLine("1 (14 oz) can crushed tomatoes, drained");

    expect(p.parsed).toBe(true);
    expect(p.qty).toBe(1);
    expect(p.unit).toBe("can");
    expect(p.ingredient).toBe("crushed tomatoes");
    expect(p.note).toBe("14 oz, drained");
  });

  test("parses Estonian household units and ingredients", () => {
    const p = parseIngredientLine("2 sl nisujahu");

    expect(p.parsed).toBe(true);
    expect(p.qty).toBe(2);
    expect(p.unit).toBe("tbsp");
    expect(p.unitKind).toBe("volume");
    expect(p.ingredient).toBe("nisujahu");
  });

  test("parses decimal-comma quantities", () => {
    const p = parseIngredientLine("3,5 dl piim");

    expect(p.parsed).toBe(true);
    expect(p.qty).toBeCloseTo(3.5);
    expect(p.ingredient).toBe("dl piim");
  });
});


