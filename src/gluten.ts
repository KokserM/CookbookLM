import type { ConvertedIngredient } from "./unit_converter";

export type GlutenFlag = {
  ingredient_en: string;
  reason: string;
};

export type SubstitutionEt = {
  ingredient: string; // english ingredient name or metric line
  suggestions_et: string[];
  note_et?: string;
  deterministic: boolean;
};

const GLUTEN_KEYWORDS = [
  // English
  "wheat",
  "flour",
  "all-purpose",
  "breadcrumbs",
  "bread",
  "pasta",
  "noodle",
  "soy sauce",
  "malt",
  "barley",
  "rye",
  "semolina",
  "couscous",
  "bulgur",
  "tortilla",
  "beer",
  "malt vinegar",
  "panko",
  "seitan",
  "cracker",
  "pita",
  "croissant",
  "crouton",
  "dumpling",
  "wonton",
  "phyllo",
  "filo",
  "puff pastry",
  "pie crust",
  "biscuit",
  "gravy mix",
  "cream of mushroom soup",
  "cream of chicken soup",
  "teriyaki",
  "hoisin",
  "oyster sauce",
  "worcestershire",
  "orzo",
  "farro",
  "spelt",
  // Estonian
  "nisu",
  "jahu",
  "nisujahu",
  "riivsai",
  "sai",
  "pasta",
  "nuudel",
  "sojakaste",
  "linnas",
  "oder",
  "rukis",
  "manna",
  "kus-kuss",
  "bulgur",
  "tortilja",
  "õlu",
  "linnaseäädikas",
  "panko",
  "küpsised",
  "pirukas",
  "lehttainas",
  "hapukoor",
  "teriyaki",
  "hoisin",
  "austrikaste",
];

function includesAny(hay: string, needles: string[]): boolean {
  const t = hay.toLowerCase();
  return needles.some((n) => t.includes(n));
}

export function detectGlutenFlags(ingredients: Array<{ metric_en: string; ingredient?: string; original: string }>): GlutenFlag[] {
  const flags: GlutenFlag[] = [];
  for (const ing of ingredients) {
    const hay = `${ing.metric_en} ${ing.ingredient ?? ""} ${ing.original}`.toLowerCase();
    if (includesAny(hay, GLUTEN_KEYWORDS)) {
      flags.push({ ingredient_en: ing.ingredient ?? ing.metric_en, reason: "Possible gluten source" });
    }
  }
  return flags;
}

export function gfSubstitutionMappingEt(metricEnLine: string, ingredientName?: string): SubstitutionEt | null {
  const t = `${metricEnLine} ${ingredientName ?? ""}`.toLowerCase();

  const mk = (ingredient: string, suggestions_et: string[], note_et?: string): SubstitutionEt => ({
    ingredient,
    suggestions_et,
    note_et,
    deterministic: true,
  });

  if (includesAny(t, ["all-purpose flour", "wheat flour", "flour", "nisujahu", "jahu", "spelt", "spelta"])) {
    return mk(
      ingredientName || "wheat flour",
      ["gluteenivaba universaalne jahusegu", "riisijahu + kartulitärklis (küpsetamisel)", "gluteenivaba kaerajahu (sertifitseeritud)"],
      "Küpsetamisel võib vaja minna ksantaankummi (vt jahusegu juhiseid).",
    );
  }
  if (includesAny(t, ["breadcrumbs", "riivsai"])) {
    return mk(ingredientName || "breadcrumbs", ["gluteenivabad riivsaiad", "purustatud gluteenivabad maisihelbed"], undefined);
  }
  if (includesAny(t, ["soy sauce", "sojakaste"])) {
    return mk(ingredientName || "soy sauce", ["tamari (gluteenivaba)", "gluteenivaba sojakaste"], "Kontrolli alati märgistust.");
  }
  if (includesAny(t, ["pasta", "noodle", "nuudel"])) {
    return mk(ingredientName || "pasta/noodles", ["gluteenivaba pasta (mais/riis)", "gluteenivabad nuudlid (riis)"], undefined);
  }
  if (includesAny(t, ["tortilla", "tortilja"])) {
    return mk(ingredientName || "tortillas", ["gluteenivabad tortiljad", "maisitortiljad (kontrolli märgistust)"], undefined);
  }
  if (includesAny(t, ["beer", "õlu"])) {
    return mk(ingredientName || "beer", ["gluteenivaba õlu", "jäta välja / kasuta alkoholivaba alternatiivi"], undefined);
  }
  if (includesAny(t, ["malt vinegar", "linnaseäädikas"])) {
    return mk(ingredientName || "malt vinegar", ["õunaäädikas", "riisiäädikas"], undefined);
  }
  if (includesAny(t, ["malt extract", "odralinnas"])) {
    return mk(ingredientName || "malt extract", ["riisisiirup", "gluteenivaba siirup (kontrolli märgistust)"], undefined);
  }
  if (includesAny(t, ["panko"])) {
    return mk(ingredientName || "panko", ["gluteenivabad panko-riivsaiad", "purustatud riisikrõpsud", "purustatud gluteenivabad maisihelbed"], undefined);
  }
  if (includesAny(t, ["seitan"])) {
    return mk(ingredientName || "seitan", ["tofu (ekstra tugev)", "tempeh (viilutatud)"], "Seitan on puhas gluteen — asenda valgurikka alternatiiviga.");
  }
  if (includesAny(t, ["cracker", "küpsised"])) {
    return mk(ingredientName || "crackers", ["gluteenivabad küpsised", "riisiküpsised"], undefined);
  }
  if (includesAny(t, ["pita"])) {
    return mk(ingredientName || "pita", ["gluteenivaba pita", "maisitortiljad"], undefined);
  }
  if (includesAny(t, ["crouton"])) {
    return mk(ingredientName || "croutons", ["gluteenivabad krutoonid", "röstitud gluteenivaba leiva kuubikud"], undefined);
  }
  if (includesAny(t, ["phyllo", "filo", "lehttainas"])) {
    return mk(ingredientName || "phyllo dough", ["gluteenivaba lehttainas", "riisipaber (spring roll)"], "GF lehttainas on keeruline — kaaluge alternatiivset retsepti.");
  }
  if (includesAny(t, ["puff pastry", "pirukas"])) {
    return mk(ingredientName || "puff pastry", ["gluteenivaba lehttainas", "gluteenivaba pirukataina"], undefined);
  }
  if (includesAny(t, ["pie crust"])) {
    return mk(ingredientName || "pie crust", ["gluteenivaba pirukataina", "mandlijahu + või pirukapõhi"], undefined);
  }
  if (includesAny(t, ["couscous", "kus-kuss"])) {
    return mk(ingredientName || "couscous", ["kvinoa", "hirsitangud", "riis"], undefined);
  }
  if (includesAny(t, ["bulgur"])) {
    return mk(ingredientName || "bulgur", ["kvinoa", "tatar", "pruun riis"], undefined);
  }
  if (includesAny(t, ["orzo"])) {
    return mk(ingredientName || "orzo", ["gluteenivaba orzo", "riisikujulised GF pasta"], undefined);
  }
  if (includesAny(t, ["farro"])) {
    return mk(ingredientName || "farro", ["tatar", "kvinoa", "pruun riis"], undefined);
  }
  if (includesAny(t, ["semolina", "manna"])) {
    return mk(ingredientName || "semolina", ["maisijahu (polenta)", "riisijahu"], undefined);
  }
  if (includesAny(t, ["teriyaki"])) {
    return mk(ingredientName || "teriyaki sauce", ["gluteenivaba teriyaki kaste", "tamari + riisisiirup + ingver"], "Enamik teriyaki kastmeid sisaldab nisu sojakastet.");
  }
  if (includesAny(t, ["hoisin"])) {
    return mk(ingredientName || "hoisin sauce", ["gluteenivaba hoisin kaste", "tamari + maapähklivõi + mesi"], "Kontrolli alati märgistust.");
  }
  if (includesAny(t, ["oyster sauce", "austrikaste"])) {
    return mk(ingredientName || "oyster sauce", ["gluteenivaba austrikaste", "gluteenivaba kalakaste"], "Enamik austrikastmeid sisaldab nisutärklist.");
  }
  if (includesAny(t, ["worcestershire"])) {
    return mk(ingredientName || "worcestershire sauce", ["gluteenivaba worcestershire kaste", "tamari + õunaäädikas"], "Traditsiooniline Lea & Perrins sisaldab linnaseäädikat.");
  }

  return null;
}

export function applyGlutenFreeDeterministicSubstitutions(
  ingredients: ConvertedIngredient[],
  glutenFree: boolean,
): { converted: ConvertedIngredient[]; substitutions: SubstitutionEt[]; flags: GlutenFlag[] } {
  const flags = detectGlutenFlags(ingredients);
  if (!glutenFree) return { converted: ingredients, substitutions: [], flags };

  const subs: SubstitutionEt[] = [];
  const converted = ingredients.map((ing) => {
    const mapped = gfSubstitutionMappingEt(ing.metric_en, ing.ingredient);
    if (!mapped) return ing;

    subs.push(mapped);

    // Rewrite the metric English line minimally so AI translates a GF ingredient.
    // Keep quantities, replace ingredient name portion if we can.
    const lineLower = ing.metric_en.toLowerCase();
    let newLine = ing.metric_en;
    if (includesAny(lineLower, ["flour", "nisujahu", "jahu", "spelt"])) {
      newLine = ing.metric_en.replace(/(flour|all-purpose flour|wheat flour|spelt)/gi, "gluten-free flour blend");
      if (newLine === ing.metric_en) newLine = `${ing.metric_en} (use gluten-free flour blend)`;
    } else if (includesAny(lineLower, ["breadcrumbs", "riivsai"])) {
      newLine = ing.metric_en.replace(/breadcrumbs/gi, "gluten-free breadcrumbs");
      if (newLine === ing.metric_en) newLine = `${ing.metric_en} (gluten-free)`;
    } else if (includesAny(lineLower, ["soy sauce", "sojakaste"])) {
      newLine = ing.metric_en.replace(/soy sauce/gi, "tamari (gluten-free)");
      if (newLine === ing.metric_en) newLine = `${ing.metric_en} (gluten-free, e.g. tamari)`;
    } else if (includesAny(lineLower, ["pasta", "noodle"])) {
      newLine = `${ing.metric_en} (gluten-free)`;
    } else if (includesAny(lineLower, ["tortilla"])) {
      newLine = `${ing.metric_en} (gluten-free)`;
    } else if (includesAny(lineLower, ["beer"])) {
      newLine = `${ing.metric_en} (gluten-free)`;
    } else if (includesAny(lineLower, ["panko"])) {
      newLine = ing.metric_en.replace(/panko/gi, "gluten-free panko");
      if (newLine === ing.metric_en) newLine = `${ing.metric_en} (gluten-free)`;
    } else if (includesAny(lineLower, ["couscous"])) {
      newLine = ing.metric_en.replace(/couscous/gi, "quinoa");
    } else if (includesAny(lineLower, ["bulgur"])) {
      newLine = ing.metric_en.replace(/bulgur/gi, "quinoa");
    } else if (includesAny(lineLower, ["orzo"])) {
      newLine = ing.metric_en.replace(/orzo/gi, "gluten-free orzo");
    } else if (includesAny(lineLower, ["farro"])) {
      newLine = ing.metric_en.replace(/farro/gi, "buckwheat");
    } else if (includesAny(lineLower, ["semolina"])) {
      newLine = ing.metric_en.replace(/semolina/gi, "cornmeal (polenta)");
    } else if (includesAny(lineLower, ["cracker"])) {
      newLine = `${ing.metric_en} (gluten-free)`;
    } else if (includesAny(lineLower, ["crouton"])) {
      newLine = `${ing.metric_en} (gluten-free)`;
    } else if (includesAny(lineLower, ["teriyaki"])) {
      newLine = `${ing.metric_en} (gluten-free)`;
    } else if (includesAny(lineLower, ["hoisin"])) {
      newLine = `${ing.metric_en} (gluten-free)`;
    } else if (includesAny(lineLower, ["oyster sauce"])) {
      newLine = `${ing.metric_en} (gluten-free)`;
    } else if (includesAny(lineLower, ["worcestershire"])) {
      newLine = `${ing.metric_en} (gluten-free)`;
    }

    return { ...ing, metric_en: newLine };
  });

  return { converted, substitutions: subs, flags };
}

function formatStarchHint(lang: "et" | "en", starchTbsp: number): string {
  const n = Math.round(starchTbsp * 2) / 2;
  if (lang === "et") {
    const qty = n % 1 === 0 ? String(Math.round(n)) : String(n).replace(".", ",");
    return `Gluteenivaba kastme paksendamiseks kasuta jahu asemel ${qty} sl maisi- või kartulitärklist, sega esmalt vähese külma veega (slurry) ja vala kastmesse, kuumuta kuni paksenemiseni.`;
  }
  const qty = n % 1 === 0 ? String(Math.round(n)) : String(n);
  return `For gluten-free thickening, use ${qty} tbsp cornstarch or potato starch instead of flour: whisk into a little cold water (slurry), then pour into the sauce and simmer until thickened.`;
}

function findFlourThickenerAmountTbsp(ingredients: ConvertedIngredient[]): number | null {
  // Heuristic: small amount of flour is likely used for sauce thickening.
  for (const ing of ingredients) {
    const name = `${ing.ingredient ?? ""} ${ing.original}`.toLowerCase();
    if (!includesAny(name, ["flour", "jahu"])) continue;
    if (!ing.parsed || !ing.qty || !ing.unit) continue;
    const q = ing.qty;
    const unit = ing.unit;
    if (unit === "tbsp") return q;
    if (unit === "tsp") return q / 3;
    if (unit === "g" && q <= 40) return q / 8; // approx 8g per tbsp flour
    if (unit === "oz" && q <= 2) return (q * 28.3495) / 8;
  }
  return null;
}

export function postProcessStepsForGlutenFreeSauce(
  stepsOut: string[],
  ingredientsForHeuristic: ConvertedIngredient[],
  outputLang: "et" | "en",
  glutenFree: boolean,
): string[] {
  if (!glutenFree) return stepsOut;

  const starchTbsp = (() => {
    const flourTbsp = findFlourThickenerAmountTbsp(ingredientsForHeuristic);
    if (flourTbsp == null) return 1; // default safe suggestion
    // Starch is ~2x stronger than flour for thickening
    return Math.max(0.5, flourTbsp / 2);
  })();

  const sauceKeywords = outputLang === "et" ? ["kaste", "kastme", "paksen"] : ["sauce", "gravy", "thicken"];
  const flourKeywords = outputLang === "et" ? ["jahu"] : ["flour"];

  let injected = false;
  return stepsOut.map((s) => {
    if (injected) return s;
    const lower = s.toLowerCase();
    if (includesAny(lower, sauceKeywords) && includesAny(lower, flourKeywords)) {
      injected = true;
      return `${s} ${formatStarchHint(outputLang, starchTbsp)}`;
    }
    return s;
  });
}


