import { describe, expect, test } from "vitest";
import { parseIngredientLine } from "../ingredient_parser";
import { convertParsedIngredientToMetricEn, convertParsedIngredientToSystemLine, convertStepsTextForSystem, convertTextImperialToMetricEn } from "../unit_converter";

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

  test("keeps source units when requested", () => {
    const p = parseIngredientLine("2 cups milk");
    const c = convertParsedIngredientToSystemLine(p, "source");

    expect(c.metric_en).toBe("2 cups milk");
  });

  test("converts metric ingredients to imperial when requested", () => {
    const p = parseIngredientLine("500 g flour");
    const c = convertParsedIngredientToSystemLine(p, "imperial");

    expect(c.metric_en).toMatch(/lb|oz/);
    expect(c.metric_en).toContain("flour");
  });

  test("converts metric step temperatures and lengths to imperial", () => {
    const [out] = convertStepsTextForSystem(["Bake at 180 °C in a 20 cm pan."], "imperial");

    expect(out).toContain("355 °F");
    expect(out).toContain("7.9 in");
  });

  test("leaves mixed measurement steps unchanged", () => {
    const [out] = convertStepsTextForSystem(["Bake at 180 °C in a 20 cm pan."], "mixed");

    expect(out).toBe("Bake at 180 °C in a 20 cm pan.");
  });
});


