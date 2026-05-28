import type { AllergenContextItem, AllergenId } from "./shared_types";
import type { ConvertedIngredient } from "./unit_converter";

type AllergenRule = {
  id: AllergenId;
  keywords: string[];
  hiddenKeywords?: string[];
  roleHints: Array<{ role: string; keywords: string[]; guidance: string }>;
  defaultGuidance: string;
};

const RULES: AllergenRule[] = [
  {
    id: "gluten",
    keywords: ["wheat", "flour", "all-purpose", "bread", "breadcrumbs", "panko", "pasta", "noodle", "barley", "rye", "spelt", "malt", "beer", "soy sauce", "teriyaki", "hoisin", "oyster sauce", "worcestershire", "nisu", "jahu", "riivsai", "oder", "rukis", "linnas", "sojakaste"],
    hiddenKeywords: ["soy sauce", "teriyaki", "hoisin", "oyster sauce", "worcestershire", "gravy mix", "cream of mushroom soup", "cream of chicken soup"],
    roleHints: [
      { role: "thickener", keywords: ["flour", "jahu"], guidance: "If flour is used to thicken sauce, reason a working gluten-free thickener and adjust the step method and amount." },
      { role: "coating", keywords: ["breadcrumbs", "panko", "riivsai"], guidance: "If used for coating or crunch, preserve texture with a gluten-free coating, account for faster browning/burning, and update heat/time wording when relevant. If breadcrumbs bind patties, fritters, or meatballs, reason whether xanthan gum, psyllium husk/powder, egg, flax/chia gel, hydration time, or a binder-containing gluten-free flour blend is needed." },
      { role: "binder/structure", keywords: ["breadcrumbs", "panko", "flour", "jahu", "riivsai"], guidance: "If flour or breadcrumbs bind patties, fritters, meatballs, dough, or batter, reason whether the gluten-free version needs xanthan gum, psyllium husk/powder, egg, flax/chia gel, hydration time, less flour, or more liquid." },
      { role: "hidden sauce gluten", keywords: ["soy sauce", "teriyaki", "hoisin", "oyster sauce", "worcestershire", "sojakaste"], guidance: "Treat as a possible hidden gluten source; reason a certified gluten-free alternative and warn about labels." },
    ],
    defaultGuidance: "For celiac-safe adaptation, reason substitutions from culinary function and include cross-contamination and certified-label warnings.",
  },
  {
    id: "dairy",
    keywords: ["milk", "cream", "butter", "cheese", "yogurt", "yoghurt", "sour cream", "buttermilk", "parmesan", "mozzarella", "piim", "koor", "või", "juust", "jogurt", "hapukoor", "pett"],
    roleHints: [
      { role: "fat", keywords: ["butter", "või"], guidance: "Preserve fat, browning, and mouthfeel; do not swap butter for plain liquid." },
      { role: "creaminess", keywords: ["cream", "milk", "koor", "piim"], guidance: "Preserve liquid volume, body, and fat level when reasoning a dairy-free swap." },
      { role: "melt", keywords: ["cheese", "juust", "mozzarella", "parmesan"], guidance: "If cheese melts or binds, reason whether a dairy-free cheese works or whether texture should be warned about." },
    ],
    defaultGuidance: "Reason dairy-free substitutions by culinary role: fat, liquid, acidity, creaminess, melting, or garnish.",
  },
  {
    id: "egg",
    keywords: ["egg", "eggs", "yolk", "white", "muna", "munakollane", "munavalge"],
    roleHints: [
      { role: "binder", keywords: ["egg", "muna"], guidance: "Determine whether egg binds, leavens, emulsifies, or coats before substituting." },
      { role: "emulsion", keywords: ["yolk", "munakollane"], guidance: "If yolk emulsifies, reason an emulsifying substitute rather than a generic egg replacement." },
    ],
    defaultGuidance: "Egg substitutions must preserve the egg's role: binding, lift, emulsion, moisture, or coating.",
  },
  {
    id: "peanut",
    keywords: ["peanut", "peanuts", "maapähkel", "maapähklivõi"],
    roleHints: [{ role: "nut fat/body", keywords: ["butter", "või"], guidance: "Preserve nutty fat/body only with a safe non-peanut alternative." }],
    defaultGuidance: "Avoid peanuts entirely and reason alternatives by role: garnish, fat/body, sauce base, or crunch.",
  },
  {
    id: "treeNut",
    keywords: ["almond", "walnut", "pecan", "cashew", "hazelnut", "pistachio", "macadamia", "mandel", "pähkel", "india pähkel", "sarapuupähkel"],
    roleHints: [{ role: "nut flour/structure", keywords: ["flour", "jahu"], guidance: "If nut flour provides structure, reason a non-nut flour blend and warn about texture." }],
    defaultGuidance: "Avoid tree nuts and reason alternatives by texture, fat, garnish, flour structure, or sauce body.",
  },
  {
    id: "soy",
    keywords: ["soy", "soya", "tofu", "miso", "edamame", "tamari", "soy sauce", "sojakaste"],
    roleHints: [{ role: "umami/salt", keywords: ["soy sauce", "tamari", "sojakaste"], guidance: "For soy allergy, do not suggest tamari; reason a soy-free salt/umami alternative." }],
    defaultGuidance: "Avoid soy and distinguish soy protein, soy milk, tofu structure, and soy-sauce umami.",
  },
  {
    id: "fish",
    keywords: ["fish", "anchovy", "fish sauce", "salmon", "tuna", "cod", "kala", "anšoovis", "kalakaste", "lõhe", "tuunikala"],
    roleHints: [{ role: "umami/salt", keywords: ["fish sauce", "anchovy", "kalakaste"], guidance: "If fish is used for umami/salt, reason a fish-free alternative and warn when flavor will differ." }],
    defaultGuidance: "Avoid fish and provide warning-heavy alternatives only when culinary function is clear.",
  },
  {
    id: "shellfish",
    keywords: ["shrimp", "prawn", "crab", "lobster", "clam", "mussel", "oyster sauce", "krevet", "krabi", "homaar", "rannakarp", "austrikaste"],
    roleHints: [{ role: "seafood flavor", keywords: ["oyster sauce", "austrikaste"], guidance: "For shellfish allergy, do not suggest oyster sauce; reason a shellfish-free umami alternative." }],
    defaultGuidance: "Avoid shellfish and warn clearly about sauces and cross-contact.",
  },
  {
    id: "sesame",
    keywords: ["sesame", "tahini", "seesam", "tahiini"],
    roleHints: [{ role: "seed paste/body", keywords: ["tahini", "tahiini"], guidance: "If sesame paste provides body, reason a sesame-free paste or sauce base." }],
    defaultGuidance: "Avoid sesame and reason alternatives by garnish, oil, paste/body, or crunch.",
  },
];

function includesAny(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter((k) => lower.includes(k));
}

function contextText(ing: ConvertedIngredient): string {
  return `${ing.metric_en} ${ing.metric_note_en ?? ""} ${ing.ingredient ?? ""} ${ing.original}`.toLowerCase();
}

function findRelevantSteps(steps: string[], matched: string[], ingredient: string): number[] {
  const terms = [...matched, ...ingredient.toLowerCase().split(/\s+/).filter((x) => x.length > 3)].slice(0, 8);
  const out: number[] = [];
  steps.forEach((step, idx) => {
    const lower = step.toLowerCase();
    if (terms.some((term) => lower.includes(term.toLowerCase()))) out.push(idx);
  });
  return out.slice(0, 4);
}

export function normalizeAllergenModes(modes: AllergenId[] | undefined, glutenFree?: boolean): AllergenId[] {
  const out = new Set<AllergenId>(modes ?? []);
  if (glutenFree) out.add("gluten");
  return Array.from(out);
}

export function buildAllergenContext(ingredients: ConvertedIngredient[], active: AllergenId[], steps: string[] = []): AllergenContextItem[] {
  const rules = RULES.filter((r) => active.includes(r.id));
  const out: AllergenContextItem[] = [];
  const seen = new Set<string>();

  for (const [idx, ing] of ingredients.entries()) {
    const text = contextText(ing);
    for (const rule of rules) {
      const matched = includesAny(text, rule.keywords);
      if (!matched.length) continue;
      const hidden = includesAny(text, rule.hiddenKeywords ?? []);
      const role = rule.roleHints.find((h) => includesAny(text, h.keywords).length);
      const ingredient = ing.ingredient || ing.metric_en || ing.original;
      const key = `${rule.id}:${ingredient.toLowerCase()}:${role?.role ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        idx,
        allergen: rule.id,
        ingredient,
        matched,
        severity: hidden.length ? "hidden_source" : "contains",
        guidance: role?.guidance ?? rule.defaultGuidance,
        ...(steps.length ? { relevantSteps: findRelevantSteps(steps, matched, ingredient) } : {}),
        ...(role?.role ? { role: role.role } : {}),
      });
    }
  }
  return out;
}

export function formatAllergenContextForPrompt(context: AllergenContextItem[]): string[] {
  return context.map((c) =>
    JSON.stringify({
      idx: c.idx,
      ingredient: c.ingredient,
      allergen: c.allergen,
      role: c.role,
      matched: c.matched,
      severity: c.severity,
      relevantSteps: c.relevantSteps ?? [],
      guidance: c.guidance,
    }),
  );
}
