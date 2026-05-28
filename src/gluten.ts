import type { ConvertedIngredient } from "./unit_converter";

export type GlutenFlag = {
  ingredient_en: string;
  reason: string;
};

export type GlutenRoleHint = {
  ingredient_en: string;
  role: "thickener" | "coating" | "structure" | "hidden_sauce";
  hint: string;
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

const HIDDEN_SAUCE_KEYWORDS = [
  "soy sauce",
  "sojakaste",
  "teriyaki",
  "hoisin",
  "oyster sauce",
  "austrikaste",
  "worcestershire",
  "gravy mix",
  "cream of mushroom soup",
  "cream of chicken soup",
];

const COATING_KEYWORDS = ["breadcrumbs", "riivsai", "panko", "cracker", "küpsised", "crouton"];
const FLOUR_KEYWORDS = ["all-purpose flour", "wheat flour", "flour", "nisujahu", "jahu", "spelt", "spelta"];

function getGlutenReason(hay: string): string {
  if (includesAny(hay, HIDDEN_SAUCE_KEYWORDS)) return "Likely hidden gluten in sauce or condiment";
  if (includesAny(hay, COATING_KEYWORDS)) return "Contains breading or crumb ingredient that is usually wheat-based";
  if (includesAny(hay, FLOUR_KEYWORDS)) return "Contains flour or another gluten grain";
  return "Possible gluten source";
}

export function detectGlutenFlags(ingredients: Array<{ metric_en: string; ingredient?: string | undefined; original: string }>): GlutenFlag[] {
  const flags: GlutenFlag[] = [];
  for (const ing of ingredients) {
    const hay = `${ing.metric_en} ${ing.ingredient ?? ""} ${ing.original}`.toLowerCase();
    if (includesAny(hay, GLUTEN_KEYWORDS)) {
      flags.push({ ingredient_en: ing.ingredient ?? ing.metric_en, reason: getGlutenReason(hay) });
    }
  }
  return flags;
}

function estimateFlourAmountTbsp(ing: ConvertedIngredient): number | null {
  const name = `${ing.ingredient ?? ""} ${ing.original}`.toLowerCase();
  if (!includesAny(name, ["flour", "jahu"])) return null;
  if (!ing.parsed || !ing.qty || !ing.unit) return null;
  const q = ing.qty;
  const unit = ing.unit;
  if (unit === "tbsp") return q;
  if (unit === "tsp") return q / 3;
  if (unit === "cup") return q * 16;
  if (unit === "g") return q / 8; // approx 8g per tbsp flour
  if (unit === "oz") return (q * 28.3495) / 8;
  return null;
}

function inferGlutenRole(ing: ConvertedIngredient): GlutenRoleHint["role"] | null {
  const t = `${ing.metric_en} ${ing.ingredient ?? ""} ${ing.original}`.toLowerCase();
  if (includesAny(t, HIDDEN_SAUCE_KEYWORDS)) return "hidden_sauce";
  if (includesAny(t, COATING_KEYWORDS)) return "coating";
  if (includesAny(t, FLOUR_KEYWORDS)) {
    const flourTbsp = estimateFlourAmountTbsp(ing);
    if (flourTbsp != null && flourTbsp <= 4) return "thickener";
    return "structure";
  }
  return null;
}

export function detectGlutenRoleHints(ingredients: ConvertedIngredient[]): GlutenRoleHint[] {
  const out: GlutenRoleHint[] = [];
  const seen = new Set<string>();
  for (const ing of ingredients) {
    const role = inferGlutenRole(ing);
    if (!role) continue;
    const ingredient = ing.ingredient ?? ing.metric_en;
    const key = `${ingredient.toLowerCase()}::${role}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let hint = "";
    if (role === "thickener") {
      const flourTbsp = estimateFlourAmountTbsp(ing);
      const starchTbsp = flourTbsp == null ? null : Math.max(0.5, Math.round((flourTbsp / 2) * 2) / 2);
      hint =
        starchTbsp == null
          ? "Use cornstarch or potato starch slurry for thickening, or GF all-purpose flour for a roux-style method."
          : `Use about ${starchTbsp} tbsp cornstarch or potato starch slurry, or the same amount of GF all-purpose flour for a roux-style method.`;
    } else if (role === "coating") {
      hint = "Use GF breadcrumbs, crushed GF cornflakes, or rice flour depending on whether you need crunch or a light coating.";
    } else if (role === "hidden_sauce") {
      hint = "Replace with a clearly labeled gluten-free sauce or condiment, especially tamari for soy-sauce-style uses.";
    } else {
      hint = "Use a GF flour blend that matches the recipe structure; mention xanthan gum only if the blend may not already contain it.";
    }
    out.push({ ingredient_en: ingredient, role, hint });
  }
  return out;
}

export function gfSubstitutionMappingEt(
  metricEnLine: string,
  ingredientName?: string,
  role?: GlutenRoleHint["role"] | null,
): SubstitutionEt | null {
  const t = `${metricEnLine} ${ingredientName ?? ""}`.toLowerCase();

  const mk = (ingredient: string, suggestions_et: string[], note_et?: string): SubstitutionEt => ({
    ingredient,
    suggestions_et,
    deterministic: true,
    ...(note_et ? { note_et } : {}),
  });

  if (includesAny(t, ["all-purpose flour", "wheat flour", "flour", "nisujahu", "jahu", "spelt", "spelta"])) {
    if (role === "thickener") {
      return mk(
        ingredientName || "wheat flour",
        ["maisitärklis", "kartulitärklis", "gluteenivaba universaalne jahusegu"],
        "Kastme paksendamiseks kasuta umbes pool jahu kogusest maisi- või kartulitärklist, sega see külma veega vedelaks pastaks ja lisa lõpus. Kui soovid teha roux' laadset põhja, kasuta sama kogus gluteenivaba universaalset jahusegu.",
      );
    }
    return mk(
      ingredientName || "wheat flour",
      ["gluteenivaba universaalne jahusegu", "riisijahu + kartulitärklis (küpsetamisel)", "gluteenivaba kaerajahu (sertifitseeritud)"],
      role === "structure"
        ? "Kasuta võimalusel 1:1 gluteenivaba jahusegu. Kui segu ei sisalda sideainet ja retsept vajab struktuuri (sai, kook, tainas), võib vaja minna ksantaankummi."
        : "Kasuta roale sobivat gluteenivaba jahusegu; küpsetamisel võib vaja minna ksantaankummi (vt jahusegu juhiseid).",
    );
  }
  if (includesAny(t, ["breadcrumbs", "riivsai"])) {
    return mk(
      ingredientName || "breadcrumbs",
      ["gluteenivabad riivsaiad", "purustatud gluteenivabad maisihelbed", "riisijahu"],
      "Krõbeda paneeringu jaoks sobivad kõige paremini gluteenivabad riivsaiad või purustatud maisihelbed; õhema katte jaoks kasuta riisijahu.",
    );
  }
  if (includesAny(t, ["soy sauce", "sojakaste"])) {
    return mk(
      ingredientName || "soy sauce",
      ["tamari (gluteenivaba)", "gluteenivaba sojakaste"],
      "Tamari annab kõige lähedasema soolase umami-maitse; kontrolli alati märgistust, sest tavaline sojakaste sisaldab sageli nisu.",
    );
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
    return mk(
      ingredientName || "teriyaki sauce",
      ["gluteenivaba teriyaki kaste", "tamari + riisisiirup + ingver"],
      "Enamik teriyaki kastmeid sisaldab nisu. Kiire asendus: tamari, veidi magusainet ja ingverit, et hoida sama magus-soolane profiil.",
    );
  }
  if (includesAny(t, ["hoisin"])) {
    return mk(
      ingredientName || "hoisin sauce",
      ["gluteenivaba hoisin kaste", "tamari + maapähklivõi + mesi"],
      "Kontrolli alati märgistust. Lihtne varuvariant on tamari, maapähklivõi ja veidi mett, mis annab sarnase magusa-umamise kastme.",
    );
  }
  if (includesAny(t, ["oyster sauce", "austrikaste"])) {
    return mk(
      ingredientName || "oyster sauce",
      ["gluteenivaba austrikaste", "gluteenivaba kalakaste"],
      "Enamik austrikastmeid sisaldab nisutärklist; kui kasutad kalakastet, lisa veidi magusust, et maitse oleks ümaram.",
    );
  }
  if (includesAny(t, ["worcestershire"])) {
    return mk(
      ingredientName || "worcestershire sauce",
      ["gluteenivaba worcestershire kaste", "tamari + õunaäädikas"],
      "Traditsiooniline Worcestershire võib sisaldada linnaseäädikat; tamari ja õunaäädikas annavad sarnase soolaka-hapuka tulemuse.",
    );
  }
  if (includesAny(t, ["gravy mix"])) {
    return mk(
      ingredientName || "gravy mix",
      ["maisitärklis + gluteenivaba puljong", "gluteenivaba kastmepulber"],
      "Valmissegudes on sageli nisujahu. Tee kaste gluteenivaba puljongi ja umbes poole koguse tärklisega võrreldes jahupõhise paksendusega.",
    );
  }
  if (includesAny(t, ["cream of mushroom soup", "cream of chicken soup"])) {
    return mk(
      ingredientName || "cream soup",
      ["gluteenivaba koorene seenekaste", "gluteenivaba koorene kanakaste"],
      "Konservsupid sisaldavad sageli nisujahu. Asenda koduse gluteenivaba kastmega ja paksenda tärkliseseguga alles lõpus.",
    );
  }

  return null;
}

export function applyGlutenFreeDeterministicSubstitutions(
  ingredients: ConvertedIngredient[],
  glutenFree: boolean,
): { converted: ConvertedIngredient[]; substitutions: SubstitutionEt[]; flags: GlutenFlag[]; roleHints: GlutenRoleHint[] } {
  const flags = detectGlutenFlags(ingredients);
  const roleHints = detectGlutenRoleHints(ingredients);
  if (!glutenFree) return { converted: ingredients, substitutions: [], flags, roleHints };

  const subs: SubstitutionEt[] = [];
  const converted = ingredients.map((ing) => {
    const role = inferGlutenRole(ing);
    const mapped = gfSubstitutionMappingEt(ing.metric_en, ing.ingredient, role);
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

  return { converted, substitutions: subs, flags, roleHints };
}

function formatStarchHint(lang: "et" | "en", starchTbsp: number): string {
  const n = Math.round(starchTbsp * 2) / 2;
  if (lang === "et") {
    const qty = n % 1 === 0 ? String(Math.round(n)) : String(n).replace(".", ",");
    return `Gluteenivaba kastme paksendamiseks kasuta jahu asemel ${qty} sl maisi- või kartulitärklist, sega see esmalt vähese külma veega ühtlaseks vedelikuks ja vala kastmesse lõpuosas, seejärel kuumuta kuni paksenemiseni.`;
  }
  const qty = n % 1 === 0 ? String(Math.round(n)) : String(n);
  return `For gluten-free thickening, use ${qty} tbsp cornstarch or potato starch instead of flour: whisk it into a little cold water first, then add it near the end and simmer until thickened.`;
}

function findFlourThickenerAmountTbsp(ingredients: ConvertedIngredient[]): number | null {
  // Heuristic: small amount of flour is likely used for sauce thickening.
  for (const ing of ingredients) {
    const tbsp = estimateFlourAmountTbsp(ing);
    if (tbsp != null && tbsp <= 4) return tbsp;
  }
  return null;
}

function formatCoatingHint(lang: "et" | "en"): string {
  if (lang === "et") {
    return "Paneeringu jaoks kasuta gluteenivabu riivsaidu või purustatud gluteenivabu maisihelbeid; õhema katte jaoks sobib riisijahu.";
  }
  return "For breading, use gluten-free breadcrumbs or crushed gluten-free cornflakes; for a lighter coating, use rice flour.";
}

export function postProcessStepsForGlutenFreeTechniques(
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

  const sauceKeywords = outputLang === "et" ? ["kaste", "kastme", "paksen", "roux"] : ["sauce", "gravy", "thicken", "roux"];
  const flourKeywords = outputLang === "et" ? ["jahu"] : ["flour"];
  const coatingKeywords = outputLang === "et" ? ["paneeri", "kat", "riivsai", "krõbe"] : ["coat", "dredge", "breadcrumb", "breaded", "crisp"];

  let sauceInjected = false;
  let coatingInjected = false;
  const hasCoatingIngredient = ingredientsForHeuristic.some((ing) =>
    includesAny(`${ing.metric_en} ${ing.ingredient ?? ""} ${ing.original}`.toLowerCase(), COATING_KEYWORDS),
  );
  return stepsOut.map((s) => {
    const lower = s.toLowerCase();
    if (includesAny(lower, sauceKeywords) && includesAny(lower, flourKeywords)) {
      if (sauceInjected) return s;
      sauceInjected = true;
      return `${s} ${formatStarchHint(outputLang, starchTbsp)}`;
    }
    if (hasCoatingIngredient && includesAny(lower, coatingKeywords)) {
      if (coatingInjected) return s;
      coatingInjected = true;
      return `${s} ${formatCoatingHint(outputLang)}`;
    }
    return s;
  });
}


