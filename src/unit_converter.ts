import type { ParsedIngredient } from "./ingredient_parser";
import type { MeasurementPreference } from "./shared_types";

export type ConvertedIngredient = ParsedIngredient & {
  metric_en: string; // metric English line for translation
  metric_note_en?: string | undefined; // optional note (English) for translation
};

export type MeasurementSystem = MeasurementPreference;

const CONV = {
  lb_g: 453.592,
  oz_g: 28.3495,
  floz_ml: 29.5735,
  tsp_ml: 5,
  tbsp_ml: 15,
  cup_ml: 240,
  pint_ml: 473,
  quart_ml: 946,
  gallon_ml: 3785,
  inch_cm: 2.54,
  g_oz: 1 / 28.3495,
  ml_floz: 1 / 29.5735,
} as const;

type Density = { keys: string[]; gPerCup: number; preferMl?: boolean };

// Used to convert volume measures (cup/tbsp/tsp) into grams for common solids.
const DENSITIES: Density[] = [
  { keys: ["all-purpose flour", "ap flour", "plain flour", "flour", "jahu", "nisujahu", "gluten-free flour", "jahusegu", "gluteenivaba jahusegu"], gPerCup: 120 },
  { keys: ["almond flour", "mandlijahu"], gPerCup: 96 },
  { keys: ["coconut flour", "kookosejahu"], gPerCup: 128 },
  { keys: ["rice flour", "riisijahu"], gPerCup: 160 },
  { keys: ["cornstarch", "corn starch", "maisi tärklis", "maisitärklis", "kartulitärklis", "potato starch"], gPerCup: 128 },
  { keys: ["tapioca", "tapioka"], gPerCup: 120 },
  { keys: ["buckwheat flour", "tatrajahu"], gPerCup: 120 },
  { keys: ["brown sugar", "pruun suhkur"], gPerCup: 220 },
  { keys: ["powdered sugar", "icing sugar", "confectioners", "tuhksuhkur"], gPerCup: 120 },
  { keys: ["sugar", "granulated sugar", "suhkur", "kristallsuhkur"], gPerCup: 200 },
  { keys: ["butter", "või"], gPerCup: 227 },
  { keys: ["parmesan", "parmigiano", "parmesani", "asiago", "juust", "cheese"], gPerCup: 100 },
  { keys: ["cream cheese", "toorjuust"], gPerCup: 232 },
  { keys: ["sour cream", "hapukoor"], gPerCup: 230 },
  { keys: ["yogurt", "yoghurt", "jogurt"], gPerCup: 245 },
  { keys: ["rice", "riis"], gPerCup: 185 },
  { keys: ["quinoa", "kvinoa"], gPerCup: 170 },
  { keys: ["oats", "kaer", "kaerahelbed"], gPerCup: 90 },
  { keys: ["cocoa", "kakao"], gPerCup: 85 },
  { keys: ["honey", "mesi"], gPerCup: 340, preferMl: true },
  { keys: ["maple syrup", "vahtra siirup"], gPerCup: 322, preferMl: true },
  { keys: ["peanut butter", "maapähklivõi"], gPerCup: 256 },
  { keys: ["breadcrumbs", "riivsai", "panko"], gPerCup: 108 },
  { keys: ["cornmeal", "polenta", "maisijahu"], gPerCup: 163 },
  { keys: ["nut", "pähkel"], gPerCup: 140 },
  { keys: ["raisin", "rosin"], gPerCup: 165 },
  { keys: ["chocolate chip", "šokolaadilaast"], gPerCup: 170 },
  // Liquids: keep ml
  { keys: ["milk", "piim", "water", "vesi", "broth", "stock", "puljong", "cream", "half and half", "koor"], gPerCup: 240, preferMl: true },
  { keys: ["coconut milk", "kookospiim"], gPerCup: 240, preferMl: true },
];

function findDensity(ingredient: string): Density | null {
  const t = ingredient.toLowerCase();
  for (const d of DENSITIES) if (d.keys.some((k) => t.includes(k))) return d;
  return null;
}

const LIQUID_HINTS = [
  "water",
  "milk",
  "cream",
  "half and half",
  "broth",
  "stock",
  "oil",
  "vinegar",
  "juice",
  "sauce",
  "wine",
  "beer",
  "spirits",
  "rum",
  "brandy",
  "extract",
  "vanilla",
  "lemon juice",
  "lime juice",
  "coconut milk",
  "buttermilk",
  "puljong",
  "piim",
  "koor",
  "vesi",
  "õli",
  "äädikas",
  "mahl",
  "kaste",
  "vein",
  "õlu",
  "piimatoode",
  "keefir",
];

function isLikelyLiquid(ingredient: string): boolean {
  const t = ingredient.toLowerCase();
  return LIQUID_HINTS.some((k) => t.includes(k));
}

function roundGrams(g: number): { value: number; unit: "g" | "kg" } {
  if (g < 10) return { value: Math.round(g), unit: "g" };
  if (g < 100) return { value: Math.round(g / 5) * 5, unit: "g" };
  if (g < 1000) return { value: Math.round(g / 10) * 10, unit: "g" };
  const kg = g / 1000;
  return { value: Math.round(kg * 10) / 10, unit: "kg" };
}

function roundMl(ml: number): { value: number; unit: "ml" | "l" } {
  if (ml < 50) return { value: Math.round(ml / 5) * 5, unit: "ml" };
  if (ml < 500) return { value: Math.round(ml / 10) * 10, unit: "ml" };
  const l = ml / 1000;
  return { value: Math.round(l * 10) / 10, unit: "l" };
}

function roundOz(oz: number): { value: number; unit: "oz" | "lb" } {
  // Simple: under 16 oz keep oz rounded to 0.5; otherwise show lb with 1 decimal.
  if (oz < 16) return { value: Math.round(oz * 2) / 2, unit: "oz" };
  const lb = oz / 16;
  return { value: Math.round(lb * 10) / 10, unit: "lb" };
}

function roundFlOz(floz: number): { value: number; unit: "tsp" | "tbsp" | "fl oz" | "cup" } {
  // Choose a human unit:
  // <= 3 tsp -> tsp, <= 4 tbsp -> tbsp, <= 2 cups -> cups, else fl oz.
  const ml = floz / CONV.ml_floz;
  const tsp = ml / CONV.tsp_ml;
  const tbsp = ml / CONV.tbsp_ml;
  const cups = ml / CONV.cup_ml;
  if (tsp <= 3) return { value: Math.round(tsp * 2) / 2, unit: "tsp" };
  if (tbsp <= 4) return { value: Math.round(tbsp * 2) / 2, unit: "tbsp" };
  if (cups <= 2) return { value: Math.round(cups * 4) / 4, unit: "cup" };
  return { value: Math.round(floz * 2) / 2, unit: "fl oz" };
}

function fmtNum(n: number): string {
  // Metric-English uses dot; AI will output decimal comma in Estonian.
  const s = n % 1 === 0 ? String(Math.round(n)) : String(n);
  return s;
}

function fmtRange(a: { value: number; unit: string }, b: { value: number; unit: string }): string {
  if (a.unit === b.unit) return `${fmtNum(a.value)}–${fmtNum(b.value)} ${a.unit}`;
  // Rare, but handle
  return `${fmtNum(a.value)} ${a.unit}–${fmtNum(b.value)} ${b.unit}`;
}

function pickQtys(p: ParsedIngredient): { a: number; b?: number | undefined; isRange: boolean } {
  const a = p.qty ?? 0;
  const b = p.qty2 ?? undefined;
  return { a, b, isRange: Boolean(p.isRange && b != null) };
}

export function convertParsedIngredientToMetricEn(p: ParsedIngredient): ConvertedIngredient {
  if (!p.parsed || !p.qty || !p.unit) {
    return { ...p, metric_en: p.original, metric_note_en: undefined };
  }

  const { a, b, isRange } = pickQtys(p);
  const unit = p.unit;
  const ingName = p.ingredient ?? "";

  let metricLine = p.original;
  let metricNote: string | undefined;

  const withNote = (line: string) => {
    if (p.note) return `${line}, ${p.note}`;
    return line;
  };

  const gramsFrom = (x: number) => roundGrams(x);
  const mlFrom = (x: number) => roundMl(x);

  const apply = () => {
    if (unit === "lb") {
      const A = gramsFrom(a * CONV.lb_g);
      if (isRange && b != null) {
        const B = gramsFrom(b * CONV.lb_g);
        metricLine = withNote(`${fmtRange(A, B)} ${ingName}`.trim());
      } else {
        metricLine = withNote(`${fmtNum(A.value)} ${A.unit} ${ingName}`.trim());
      }
      return;
    }
    if (unit === "oz") {
      const A = gramsFrom(a * CONV.oz_g);
      if (isRange && b != null) {
        const B = gramsFrom(b * CONV.oz_g);
        metricLine = withNote(`${fmtRange(A, B)} ${ingName}`.trim());
      } else {
        metricLine = withNote(`${fmtNum(A.value)} ${A.unit} ${ingName}`.trim());
      }
      return;
    }
    if (unit === "fl oz") {
      const A = mlFrom(a * CONV.floz_ml);
      if (isRange && b != null) {
        const B = mlFrom(b * CONV.floz_ml);
        metricLine = withNote(`${fmtRange(A, B)} ${ingName}`.trim());
      } else {
        metricLine = withNote(`${fmtNum(A.value)} ${A.unit} ${ingName}`.trim());
      }
      return;
    }
    if (unit === "tsp") {
      const density = findDensity(ingName);
      if (density && !density.preferMl) {
        // Convert tsp->ml then ml->g via density
        const gPerMl = density.gPerCup / CONV.cup_ml;
        const A = gramsFrom(a * CONV.tsp_ml * gPerMl);
        if (isRange && b != null) {
          const B = gramsFrom(b * CONV.tsp_ml * gPerMl);
          metricLine = withNote(`${fmtRange(A, B)} ${ingName}`.trim());
        } else {
          metricLine = withNote(`${fmtNum(A.value)} ${A.unit} ${ingName}`.trim());
        }
        return;
      }
      if (isLikelyLiquid(ingName)) {
        const A = mlFrom(a * CONV.tsp_ml);
        if (isRange && b != null) {
          const B = mlFrom(b * CONV.tsp_ml);
          metricLine = withNote(`${fmtRange(A, B)} ${ingName}`.trim());
        } else {
          metricLine = withNote(`${fmtNum(A.value)} ${A.unit} ${ingName}`.trim());
        }
        return;
      }
      // Prefer Estonian teaspoons/tablespoons for spices/herbs instead of raw ml
      if (isRange && b != null) metricLine = withNote(`${fmtNum(a)}–${fmtNum(b)} tl ${ingName}`.trim());
      else metricLine = withNote(`${fmtNum(a)} tl ${ingName}`.trim());
      return;
    }
    if (unit === "tbsp") {
      const density = findDensity(ingName);
      if (density && !density.preferMl) {
        const gPerMl = density.gPerCup / CONV.cup_ml;
        const A = gramsFrom(a * CONV.tbsp_ml * gPerMl);
        if (isRange && b != null) {
          const B = gramsFrom(b * CONV.tbsp_ml * gPerMl);
          metricLine = withNote(`${fmtRange(A, B)} ${ingName}`.trim());
        } else {
          metricLine = withNote(`${fmtNum(A.value)} ${A.unit} ${ingName}`.trim());
        }
        return;
      }
      if (isLikelyLiquid(ingName)) {
        const A = mlFrom(a * CONV.tbsp_ml);
        if (isRange && b != null) {
          const B = mlFrom(b * CONV.tbsp_ml);
          metricLine = withNote(`${fmtRange(A, B)} ${ingName}`.trim());
        } else {
          metricLine = withNote(`${fmtNum(A.value)} ${A.unit} ${ingName}`.trim());
        }
        return;
      }
      if (isRange && b != null) metricLine = withNote(`${fmtNum(a)}–${fmtNum(b)} sl ${ingName}`.trim());
      else metricLine = withNote(`${fmtNum(a)} sl ${ingName}`.trim());
      return;
    }
    if (unit === "cup") {
      const density = findDensity(ingName);
      if (density && !density.preferMl) {
        const A = gramsFrom(a * density.gPerCup);
        if (isRange && b != null) {
          const B = gramsFrom(b * density.gPerCup);
          metricLine = withNote(`${fmtRange(A, B)} ${ingName}`.trim());
        } else {
          metricLine = withNote(`${fmtNum(A.value)} ${A.unit} ${ingName}`.trim());
        }
        return;
      }
      const A = mlFrom(a * CONV.cup_ml);
      if (isRange && b != null) {
        const B = mlFrom(b * CONV.cup_ml);
        metricLine = withNote(`${fmtRange(A, B)} ${ingName}`.trim());
      } else {
        metricLine = withNote(`${fmtNum(A.value)} ${A.unit} ${ingName}`.trim());
      }
      // Note when we didn't convert to grams (unknown density)
      if (!density) metricNote = "(volume ml; exact weight depends on ingredient)";
      return;
    }
    if (unit === "pint" || unit === "quart" || unit === "gallon") {
      const factor = unit === "pint" ? CONV.pint_ml : unit === "quart" ? CONV.quart_ml : CONV.gallon_ml;
      const A = mlFrom(a * factor);
      if (isRange && b != null) {
        const B = mlFrom(b * factor);
        metricLine = withNote(`${fmtRange(A, B)} ${ingName}`.trim());
      } else {
        metricLine = withNote(`${fmtNum(A.value)} ${A.unit} ${ingName}`.trim());
      }
      return;
    }
    if (unit === "stick") {
      const ingLower = ingName.toLowerCase();
      if (ingLower.includes("butter") || ingLower.includes("või") || ingLower.includes("margarin")) {
        const A = gramsFrom(a * 113);
        if (isRange && b != null) {
          const B = gramsFrom(b * 113);
          metricLine = withNote(`${fmtRange(A, B)} ${ingName}`.trim());
        } else {
          metricLine = withNote(`${fmtNum(A.value)} ${A.unit} ${ingName}`.trim());
        }
        return;
      }
    }

    metricLine = withNote(`${fmtNum(a)} ${unit} ${ingName}`.trim());
  };

  apply();
  return { ...p, metric_en: metricLine, metric_note_en: metricNote };
}

export function convertAllIngredientsToMetricEn(parsed: ParsedIngredient[]): ConvertedIngredient[] {
  return parsed.map(convertParsedIngredientToMetricEn);
}

export function convertParsedIngredientToSystemLine(p: ParsedIngredient, target: MeasurementSystem): ConvertedIngredient {
  // Currently, metric_en field will carry the target-system line (still "metric_en" for backward compat).
  if (target === "metric") return convertParsedIngredientToMetricEn(p);
  if (target === "source" || target === "mixed") return { ...p, metric_en: p.original };

  if (!p.parsed || !p.qty || !p.unit) return { ...p, metric_en: p.original };

  const unit = p.unit;
  const ingName = p.ingredient ?? "";
  const a = p.qty ?? 0;
  const b = p.qty2;
  const isRange = Boolean(p.isRange && b != null);

  const withNote = (line: string) => (p.note ? `${line}, ${p.note}` : line);

  const toOz = (g: number) => roundOz(g * CONV.g_oz);
  const toFlOz = (ml: number) => roundFlOz(ml * CONV.ml_floz);

  let line = p.original;
  let metricNote: string | undefined;

  // If already imperial, keep (but normalize tl/sl already parsed as tsp/tbsp).
  if (unit === "lb" || unit === "oz" || unit === "fl oz" || unit === "cup" || unit === "tbsp" || unit === "tsp" || unit === "pint" || unit === "quart" || unit === "gallon") {
    // Keep as-is (no conversion) because it's already imperial-ish.
    return { ...p, metric_en: withNote(`${fmtNum(a)}${isRange ? `–${fmtNum(b!)}` : ""} ${unit} ${ingName}`.trim()), metric_note_en: metricNote };
  }

  // g/kg -> oz/lb
  if (unit === "g" || unit === "kg") {
    const gA = unit === "kg" ? a * 1000 : a;
    const A = toOz(gA);
    if (isRange && b != null) {
      const gB = unit === "kg" ? b * 1000 : b;
      const B = toOz(gB);
      line = withNote(`${fmtRange(A, B)} ${ingName}`.trim());
    } else {
      line = withNote(`${fmtNum(A.value)} ${A.unit} ${ingName}`.trim());
    }
    return { ...p, metric_en: line, metric_note_en: metricNote };
  }

  // ml/l -> fl oz / cup / tbsp / tsp
  if (unit === "ml" || unit === "l") {
    const mlA = unit === "l" ? a * 1000 : a;
    const A = toFlOz(mlA);
    if (isRange && b != null) {
      const mlB = unit === "l" ? b * 1000 : b;
      const B = toFlOz(mlB);
      line = withNote(`${fmtRange(A, B)} ${ingName}`.trim());
    } else {
      line = withNote(`${fmtNum(A.value)} ${A.unit} ${ingName}`.trim());
    }
    return { ...p, metric_en: line, metric_note_en: metricNote };
  }

  // default: count/unknown
  return { ...p, metric_en: withNote(`${fmtNum(a)} ${unit} ${ingName}`.trim()), metric_note_en: metricNote };
}

export function convertStepsTextForSystem(texts: string[], target: MeasurementSystem): string[] {
  if (target === "metric") return texts.map(convertTextImperialToMetricEn);
  if (target === "source" || target === "mixed") return texts;

  // metric -> imperial (°C -> °F, cm -> inch)
  return texts.map((text) => {
    let s = text;
    s = s.replace(/(\d{2,3})\s*°\s*C\b/gi, (_, cStr) => {
      const c = Number(cStr);
      const f = c * 9 / 5 + 32;
      const f5 = Math.round(f / 5) * 5;
      return `${f5} °F`;
    });
    s = s.replace(/(\d+(?:\.\d+)?)\s*cm\b/gi, (_, cmStr) => {
      const cm = Number(cmStr);
      const inch = cm / CONV.inch_cm;
      const inTxt = (Math.round(inch * 10) / 10);
      const out = inTxt % 1 === 0 ? String(Math.round(inTxt)) : String(inTxt);
      return `${out} in`;
    });
    return s;
  });
}

export function convertTextImperialToMetricEn(text: string): string {
  // Deterministic conversions inside step text (temperature + pan sizes + common measures).
  let s = text;

  // Temperature: 350°F -> 175 °C (nearest 5°C)
  s = s.replace(/(\d{2,3})\s*°\s*F\b/gi, (_, fStr) => {
    const f = Number(fStr);
    const c = ((f - 32) * 5) / 9;
    const c5 = Math.round(c / 5) * 5;
    return `${c5} °C`;
  });

  // Inches: 8-inch -> 20 cm
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:-|\s)?in(?:ch(?:es)?)?\b/gi, (_, inchStr) => {
    const inch = Number(inchStr);
    if (!isFinite(inch)) return `${inchStr} in`;
    const cm = Math.round((inch * CONV.inch_cm) * 10) / 10;
    const cmTxt = cm % 1 === 0 ? String(Math.round(cm)) : String(cm);
    return `${cmTxt} cm`;
  });

  return s;
}


