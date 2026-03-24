import { describe, expect, test } from "vitest";
import { parseIngredientLine } from "../ingredient_parser";
import { convertParsedIngredientToMetricEn, convertTextImperialToMetricEn } from "../unit_converter";

describe("unit_converter", () => {
  test("converts oz to g with rounding", () => {
    const p = parseIngredientLine("14 oz tomatoes");
    const c = convertParsedIngredientToMetricEn(p);
    expect(c.metric_en).toMatch(/g tomatoes/i);
  });

  test("converts cups flour to grams using density", () => {
    const p = parseIngredientLine("1 cup all-purpose flour");
    const c = convertParsedIngredientToMetricEn(p);
    expect(c.metric_en.toLowerCase()).toContain("g all-purpose flour");
  });

  test("converts 1/2 lb to grams", () => {
    const p = parseIngredientLine("½ lb penne pasta");
    const c = convertParsedIngredientToMetricEn(p);
    expect(c.metric_en.toLowerCase()).toMatch(/g penne pasta/);
  });

  test("converts 1/2 lb. (with dot) to grams", () => {
    const p = parseIngredientLine("½ lb. penne pasta");
    const c = convertParsedIngredientToMetricEn(p);
    expect(c.metric_en.toLowerCase()).toMatch(/g penne pasta/);
  });

  test("keeps tsp as tl for dry herb mixes", () => {
    const p = parseIngredientLine("1 tsp Italian herb seasoning");
    const c = convertParsedIngredientToMetricEn(p);
    expect(c.metric_en.toLowerCase()).toContain(" tl italian herb seasoning");
  });

  test("converts F to C in steps", () => {
    const out = convertTextImperialToMetricEn("Bake at 350°F for 10 minutes.");
    expect(out).toContain("175 °C");
  });
});


