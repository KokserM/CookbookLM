export type UnitKind = "mass" | "volume" | "count" | "temp" | "length" | "unknown";

export type ParsedIngredient = {
  original: string;
  parsed: boolean;
  qty?: number;
  qty2?: number; // range end
  unit?: string; // normalized, e.g. "cup", "tbsp", "tsp", "oz", "lb", "clove", "can"
  unitKind?: UnitKind;
  ingredient?: string; // remaining ingredient name
  note?: string; // trailing notes (e.g. "at room temperature")
  isRange?: boolean;
};

const UNICODE_FRACTIONS: Record<string, number> = {
  "¼": 1 / 4,
  "½": 1 / 2,
  "¾": 3 / 4,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 1 / 8,
  "⅜": 3 / 8,
  "⅝": 5 / 8,
  "⅞": 7 / 8,
};

function normSpace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function replaceUnicodeFractions(s: string): string {
  return s.replace(/[¼½¾⅓⅔⅛⅜⅝⅞]/g, (m) => String(UNICODE_FRACTIONS[m] ?? m));
}

function parseFractionToken(tok: string): number | null {
  const m = tok.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!isFinite(a) || !isFinite(b) || b === 0) return null;
  return a / b;
}

function parseNumberToken(tok: string): number | null {
  const t = tok.replace(",", ".");
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const frac = parseFractionToken(t);
  if (frac != null) return frac;
  return null;
}

function parseLeadingQuantity(s: string): { qty?: number; qty2?: number; rest: string; isRange: boolean } {
  // Supports: "1", "1 1/2", "1-2", "1–2", "1 to 2", "1 and 1/2"
  // Insert spaces around unicode fractions so patterns like "1¼" or "½lb" become parseable.
  let pre = s
    .replace(/(\d)([¼½¾⅓⅔⅛⅜⅝⅞])/g, "$1 $2")
    .replace(/([¼½¾⅓⅔⅛⅜⅝⅞])([a-zA-Z])/g, "$1 $2");
  let t = replaceUnicodeFractions(normSpace(pre));
  t = t.replace(/\b(and)\b/gi, " ");

  const rangeDash = t.match(/^(\d+(?:[.,]\d+)?|\d+\/\d+)\s*(?:-|\u2013|\u2014)\s*(\d+(?:[.,]\d+)?|\d+\/\d+)\s+(.*)$/);
  if (rangeDash) {
    const a = parseNumberToken(rangeDash[1]);
    const b = parseNumberToken(rangeDash[2]);
    if (a != null && b != null) return { qty: a, qty2: b, rest: rangeDash[3], isRange: true };
  }

  const rangeTo = t.match(/^(\d+(?:[.,]\d+)?|\d+\/\d+)\s+(?:to)\s+(\d+(?:[.,]\d+)?|\d+\/\d+)\s+(.*)$/i);
  if (rangeTo) {
    const a = parseNumberToken(rangeTo[1]);
    const b = parseNumberToken(rangeTo[2]);
    if (a != null && b != null) return { qty: a, qty2: b, rest: rangeTo[3], isRange: true };
  }

  // Mixed number: "1 1/2"
  const mixed = t.match(/^(\d+)\s+(\d+\/\d+)\s+(.*)$/);
  if (mixed) {
    const a = Number(mixed[1]);
    const b = parseFractionToken(mixed[2]);
    if (b != null) return { qty: a + b, rest: mixed[3], isRange: false };
  }

  // Mixed number after unicode replacement: "1 0.25"
  const mixedDec = t.match(/^(\d+)\s+(0\.\d+)\s+(.*)$/);
  if (mixedDec) {
    const a = Number(mixedDec[1]);
    const b = parseNumberToken(mixedDec[2]);
    if (b != null) return { qty: a + b, rest: mixedDec[3], isRange: false };
  }

  const single = t.match(/^(\d+(?:[.,]\d+)?|\d+\/\d+)\s+(.*)$/);
  if (single) {
    const a = parseNumberToken(single[1]);
    if (a != null) return { qty: a, rest: single[2], isRange: false };
  }

  return { rest: normSpace(s), isRange: false };
}

type UnitDef = { unit: string; kind: UnitKind; aliases: string[] };

const UNITS: UnitDef[] = [
  { unit: "tsp", kind: "volume", aliases: ["tsp", "teaspoon", "teaspoons", "t"] },
  { unit: "tbsp", kind: "volume", aliases: ["tbsp", "tablespoon", "tablespoons", "T"] },
  { unit: "cup", kind: "volume", aliases: ["cup", "cups"] },
  // Estonian common units
  { unit: "tsp", kind: "volume", aliases: ["tl"] },
  { unit: "tbsp", kind: "volume", aliases: ["sl"] },
  { unit: "cup", kind: "volume", aliases: ["tass", "tassi", "tassi", "tasse"] },
  { unit: "fl oz", kind: "volume", aliases: ["fl oz", "floz", "fluid ounce", "fluid ounces"] },
  { unit: "pint", kind: "volume", aliases: ["pint", "pints", "pt"] },
  { unit: "quart", kind: "volume", aliases: ["quart", "quarts", "qt"] },
  { unit: "gallon", kind: "volume", aliases: ["gallon", "gallons", "gal"] },
  { unit: "ml", kind: "volume", aliases: ["ml", "milliliter", "milliliters", "millilitre", "millilitres"] },
  { unit: "l", kind: "volume", aliases: ["l", "liter", "liters", "litre", "litres"] },
  { unit: "oz", kind: "mass", aliases: ["oz", "ounce", "ounces"] },
  { unit: "lb", kind: "mass", aliases: ["lb", "lbs", "pound", "pounds"] },
  { unit: "g", kind: "mass", aliases: ["g", "gram", "grams"] },
  { unit: "kg", kind: "mass", aliases: ["kg", "kilogram", "kilograms"] },
  { unit: "clove", kind: "count", aliases: ["clove", "cloves"] },
  { unit: "clove", kind: "count", aliases: ["küüs", "küünt", "küüned"] },
  { unit: "can", kind: "count", aliases: ["can", "cans"] },
  { unit: "package", kind: "count", aliases: ["package", "packages", "pkt", "pack", "packs", "pakk", "pakki"] },
  { unit: "stick", kind: "count", aliases: ["stick", "sticks"] },
  { unit: "bunch", kind: "count", aliases: ["bunch", "bunches", "kimbu", "kimp"] },
  { unit: "sprig", kind: "count", aliases: ["sprig", "sprigs"] },
  { unit: "head", kind: "count", aliases: ["head", "heads"] },
  { unit: "stalk", kind: "count", aliases: ["stalk", "stalks"] },
  { unit: "slice", kind: "count", aliases: ["slice", "slices", "viil", "viilu"] },
  { unit: "piece", kind: "count", aliases: ["piece", "pieces", "pc", "pcs", "tükk", "tükki"] },
  { unit: "pinch", kind: "count", aliases: ["pinch", "pinches", "näputäis"] },
  { unit: "dash", kind: "count", aliases: ["dash", "dashes"] },
  { unit: "handful", kind: "count", aliases: ["handful", "handfuls", "peotäis"] },
  { unit: "inch", kind: "length", aliases: ["inch", "inches", "in"] },
  { unit: "cm", kind: "length", aliases: ["cm", "centimeter", "centimeters"] },
];

const UNITS_SORTED = [...UNITS].sort(
  (a, b) => Math.max(...b.aliases.map((x) => x.length)) - Math.max(...a.aliases.map((x) => x.length)),
);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchUnit(rest: string): { unit?: string; unitKind?: UnitKind; rest: string } {
  const t = normSpace(rest);
  const lower = t.toLowerCase();

  // Prefer multi-token units first (fl oz)
  for (const def of UNITS_SORTED) {
    for (const alias of def.aliases) {
      const a = alias.toLowerCase();
      // Accept optional trailing punctuation like "lb." or "oz,".
      const re = new RegExp(`^${escapeRegExp(a)}[\\.,]?(?:\\s|$)`, "i");
      const m = lower.match(re);
      if (m) {
        const consumed = m[0].length;
        const remaining = t.slice(consumed).trim();
        return { unit: def.unit, unitKind: def.kind, rest: remaining };
      }
    }
  }
  return { rest: t };
}

export function parseIngredientLine(line: string): ParsedIngredient {
  const original = normSpace(line);
  if (!original) return { original: line, parsed: false };

  // Non-quantified lines
  if (/to taste/i.test(original)) return { original, parsed: false };
  if (/^\s*(salt|pepper)\b/i.test(original)) return { original, parsed: false };

  // Handle parenthetical package sizes like "1 (14 oz) can tomatoes"
  const paren = original.match(/^(.*?)\(([^)]+)\)\s*(.*)$/);
  let base = original;
  let parenNote: string | undefined;
  if (paren) {
    base = normSpace(`${paren[1]} ${paren[3]}`);
    parenNote = normSpace(paren[2]);
  }

  const { qty, qty2, rest, isRange } = parseLeadingQuantity(base);
  if (qty == null) return { original, parsed: false };

  const unitMatch = matchUnit(rest);
  const afterUnit = unitMatch.rest;

  // Split note after comma
  const [ingredientPart, notePart] = afterUnit.split(/\s*,\s*/, 2);
  const ingredient = normSpace(ingredientPart);
  const note = normSpace([parenNote, notePart].filter(Boolean).join(", "));

  if (!ingredient) return { original, parsed: false };

  return {
    original,
    parsed: true,
    qty,
    qty2,
    isRange,
    unit: unitMatch.unit,
    unitKind: unitMatch.unitKind ?? "unknown",
    ingredient,
    note: note || undefined,
  };
}

export function parseAllIngredientLines(lines: string[]): ParsedIngredient[] {
  return lines.map(parseIngredientLine);
}


