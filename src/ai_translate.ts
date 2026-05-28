import type { AiTaskType, AllergenId, MeasurementPreference, TranslateResultEt } from "./shared_types";

type OpenAIResponsesResponse = any;

const TRANSLATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "ingredients", "steps", "extra_substitutions", "warnings"],
  properties: {
    title: { type: "string" },
    ingredients: { type: "array", items: { type: "string" } },
    steps: { type: "array", items: { type: "string" } },
    extra_substitutions: {
      type: ["array", "null"],
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ingredient_in", "suggestions_et", "note_et"],
        properties: {
          ingredient_in: { type: "string" },
          suggestions_et: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
          note_et: { type: ["string", "null"] },
        },
      },
    },
    warnings: { type: ["array", "null"], items: { type: "string" } },
  },
} as const;

const VALIDATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["warnings"],
  properties: {
    warnings: { type: ["array", "null"], items: { type: "string" } },
  },
} as const;

function extractOutputText(resp: OpenAIResponsesResponse): string {
  if (typeof resp?.output_text === "string" && resp.output_text.trim()) return resp.output_text.trim();
  const outputs = Array.isArray(resp?.output) ? resp.output : [];
  for (const out of outputs) {
    const content = Array.isArray(out?.content) ? out.content : [];
    for (const c of content) {
      if (c?.type === "output_text" && typeof c?.text === "string" && c.text.trim()) return c.text.trim();
    }
  }
  return "";
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

function isAbortError(e: unknown): boolean {
  const anyE: any = e;
  return anyE?.name === "AbortError" || (typeof anyE?.message === "string" && anyE.message.toLowerCase().includes("abort"));
}

function normalizeNullable(out: any): TranslateResultEt {
  const obj: any = { ...out };
  if (obj.extra_substitutions === null) delete obj.extra_substitutions;
  if (obj.warnings === null) delete obj.warnings;
  if (Array.isArray(obj.extra_substitutions)) {
    obj.extra_substitutions = obj.extra_substitutions.map((x: any) => {
      const y: any = { ...x };
      if (y.note_et === null) delete y.note_et;
      return y;
    });
  }
  return obj as TranslateResultEt;
}

function validate(out: any, expectedIngLen: number, expectedStepLen: number): TranslateResultEt {
  if (!out || typeof out !== "object") throw new Error("AI: JSON ei ole objekt.");
  if (typeof out.title !== "string") throw new Error("AI: puudub title.");
  if (!Array.isArray(out.ingredients) || !Array.isArray(out.steps)) throw new Error("AI: puuduvad massiivid.");
  if (out.ingredients.length !== expectedIngLen) throw new Error("AI: ingredients pikkus ei klapi.");
  if (out.steps.length !== expectedStepLen) throw new Error("AI: steps pikkus ei klapi.");
  return normalizeNullable(out);
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const CACHE_PREFIX = "aiTranslateCache:";

export type TranslateInput = {
  taskType: AiTaskType;
  model: string;
  apiKey: string;
  source_url: string;
  title_in: string;
  ingredients_in: string[];
  steps_in: string[];
  includeSubstitutions: boolean;
  activeAllergens: AllergenId[];
  measurementPreference: MeasurementPreference;
  targetLanguage: "et" | "en";
  allergenContext: string[];
};

export type SubstitutionValidationInput = {
  model: string;
  apiKey: string;
  source_url: string;
  targetLanguage: "et" | "en";
  activeAllergens: AllergenId[];
  substitutions: Array<{ ingredient_en: string; suggestions_et: string[]; note_et?: string | undefined }>;
  relevantIngredients: string[];
  relevantSteps: string[];
};

function reasoningForTask(taskType: AiTaskType): "low" | "medium" {
  return taskType === "allergen_adaptation" || taskType === "validation_only" ? "medium" : "low";
}

function timeoutForTask(taskType: AiTaskType): number {
  if (taskType === "allergen_adaptation") return 180_000;
  if (taskType === "validation_only") return 120_000;
  return 90_000;
}

function buildInstructionsEt(input: TranslateInput): string {
  const lines: string[] = [
    "You are an expert Estonian culinary translator who writes like a native Estonian cookbook author.",
    "Your task: translate the English recipe into natural, idiomatic Estonian as it would appear in a professional Estonian cookbook (e.g. Nõo Lihatööstuse kokaraamat, Ene Rõtmani retseptid).",
    "Output ONLY valid JSON matching the schema. No markdown, no commentary, no extra keys.",
    `AI task type: ${input.taskType}.`,
    "",

    "═══ ESTONIAN GRAMMAR FOR RECIPES ═══",
    "IMPERATIVE MOOD: All steps must use 2nd person singular imperative (käskiv kõneviis):",
    '  "Add the butter" → "Lisa või" (NOT "Lisada tuleks või" or "Lisage või")',
    '  "Stir until smooth" → "Sega, kuni segu on sile"',
    '  "Let it cool" → "Lase jahtuda"',
    "",
    "PARTITIVE CASE for ingredients after quantities:",
    '  "200 g flour" → "200 g jahu" (partitive of "jahu")',
    '  "2 eggs" → "2 muna" (partitive of "muna")',
    '  "1 onion" → "1 sibul" (nominative when count=1, whole item)',
    '  "3 cloves garlic" → "3 küünt küüslauku"',
    "",
    "DECIMAL COMMA: 1.5 → 1,5 (ALWAYS comma, never dot for decimals).",
    "UNIT ABBREVIATIONS: g, kg, ml, l, tl (teelusikas), sl (supilusikas), °C. Never write out full unit words.",
    "",

    "═══ COOKING VERB SEMANTICS ═══",
    "Translate cooking verbs by their CULINARY meaning, not dictionary meaning:",
    "  fold (baking) → sega ettevaatlikult sisse (NOT voldi)",
    "  whisk → vahusta / vispelda",
    "  beat (eggs/cream) → klopi / vahusta",
    "  sauté → prae kergelt",
    "  simmer → keeda tasasel tulel / hauta madalal kuumusel",
    "  drain → nõruta / kurna",
    "  dice → lõika kuubikuteks",
    "  mince → haki peeneks",
    "  julienne → lõika ribadeks",
    "  toss (salad) → sega kergelt",
    "  broil → grilli (ülevalt kuumutades)",
    "  knead → sõtku",
    "  proof/rise (dough) → lase kerkida",
    "  rest (meat) → lase puhata / seista",
    "  season → maitsesta",
    "  season to taste → maitsesta soola ja pipraga",
    "  deglaze → keeda panni põhi lahti (veiniga/puljongiga)",
    "  blanch → blanšeeri / kasta kiirelt keevasse vette",
    "  braise → hauta",
    "  roast (oven) → küpseta ahjus",
    "  toast (bread/nuts) → röösti",
    "  caramelize → karamelliseeri",
    "  reduce (sauce) → keeda kokku",
    "  cream (butter+sugar) → vahusta kooreseks",
    "  zest → riivi (koort)",
    "  coat → kata / pane ümber",
    "  set aside → pane kõrvale",
    "  bring to a boil → kuumuta keemiseni",
    "  golden brown → kuldpruuniks",
    "  room temperature → toasoojale",
    "",

    "═══ INGREDIENT NAME CONVENTIONS ═══",
    "Use standard Estonian grocery/kitchen names:",
    "  cilantro/coriander → koriander (the herb, NOT seemned)",
    "  scallions / green onions → rohelised sibulad / talisibulad",
    "  heavy cream → koor (35%)",
    "  light cream / half-and-half → koor (10–20%)",
    "  buttermilk → pett (or keefir as substitute note)",
    "  baking soda → söögisööda",
    "  baking powder → küpsetuspulber",
    "  cornstarch → maisitärklis",
    "  all-purpose flour → nisujahu",
    "  self-rising flour → kerkiva nisujahu (with küpsetuspulber)",
    "  vanilla extract → vaniljeekstrakt",
    "  confectioners' sugar / powdered sugar → tuhksuhkur",
    "  brown sugar → pruunsuhkur",
    "  granulated sugar → kristallsuhkur",
    "  vegetable oil → taimne õli",
    "  canola oil → rapsiseemneõli",
    "  shortening → taimne rasv",
    "  cream cheese → toorjuust",
    "  ricotta → ricotta (keep as-is)",
    "  mozzarella → mozzarella (keep as-is)",
    "  shallot → šalott",
    "  bell pepper → paprika",
    "  zucchini → suvikõrvits",
    "  eggplant → baklažaan",
    "  arugula → rukola",
    "  kale → lehtkapsas",
    "  collard greens → lehtpeedi lehed (or lehtkapsas)",
    "  chicken broth / stock → kanalieem / kanalieem",
    "  ground beef → veisehakkliha",
    "  ground meat → hakkliha",
    "  al dente → al dente (keep Italian term)",
    "  Keep proper nouns and widely-known foreign terms (pesto, hummus, tzatziki, etc.).",
    "",

    "═══ STYLE ═══",
    "- Write concise, direct instructions like a trusted Estonian home cook.",
    "- Do NOT over-explain obvious steps.",
    '- Prefer active constructions: "Prae sibulad pehmeks" over "Sibulaid tuleks praadida, kuni need on pehmed."',
    "- For title: translate the dish name naturally. If the dish has a well-known Estonian name, use it.",
    '  "Chicken Pot Pie" → "Kanapasteet" (NOT "Kana poti pirukas")',
    '  "Banana Bread" → "Banaanileib"',
    '  "Beef Stroganoff" → "Stroganov" (keep the recognized name)',
    "- If the title contains a proper name or blog branding, simplify or drop it.",
    "",

    "═══ STRICT CONSTRAINTS ═══",
    "- Keep array lengths and element order EXACTLY as input. Each input line maps to exactly one output line.",
    "- Do NOT merge, split, reorder, add, or remove elements.",
    "- Preserve the selected measurement convention from the input payload. Only change quantities when an active allergen substitution requires a real functional ratio change.",
    "- Do NOT invent ingredients, steps, or information not present in the source.",
    "- Preserve parenthetical notes, translate them naturally: '(about 2 cups)' → '(umbes 480 ml)'.",
  ];

  if (input.activeAllergens.length) {
    lines.push(
      "",
      "═══ ALLERGEN / DIETARY ADAPTATION MODE (ACTIVE) ═══",
      `Active restrictions: ${input.activeAllergens.join(", ")}.`,
      "Local code provides detected risks and culinary-role context only. YOU must reason the actual substitutions and recipe-guide changes.",
      "Your adaptation rules:",
      "1. Preserve the original recipe intent and culinary result. Reason from function: thickener, roux, coating, binding, leavening, fat, creaminess, umami, structure, garnish.",
      "2. Keep ingredient and step array lengths/order exactly the same, but update the text inside each corresponding line when a substitution changes an ingredient or technique.",
      "3. Ingredient lines must include replacement amounts when a reliable functional ratio can be reasoned. If exact amounts cannot be safely reasoned, give a cautious ratio/method note in extra_substitutions.note_et.",
      "4. For celiac/gluten: never claim safety without certified gluten-free labels; include cross-contamination warnings.",
      "5. If a safe or workable substitution is uncertain, warn instead of guessing.",
      "6. Concrete examples for gluten/celiac reasoning:",
      "   - Sauce/gravy thickening: reason whether the original flour is making a roux, slurry, coating, or body. Gluten-free flour blends often need less flour or slightly more liquid because they absorb differently; starches thicken faster and can turn gluey if overcooked.",
      "   - For cornstarch/potato starch: use about HALF the wheat-flour amount, mix with cold liquid first (slurry), add near the end, and simmer briefly only until thickened.",
      "   - Roux-style sauce base: do NOT claim starch behaves exactly like wheat flour in a roux. Prefer certified gluten-free all-purpose flour blend for a true roux-style method, or switch to a starch slurry added later and adjust liquid/body accordingly.",
      "   - Coating/breading: prefer certified gluten-free breadcrumbs, crushed gluten-free cornflakes, or rice flour depending on crunch/light coating. Warn that gluten-free breadcrumbs and starch coatings may brown or burn faster; suggest lower heat, shorter frying time, or closer monitoring when relevant.",
      "   - Patties/fritters/meatballs: if flour/breadcrumbs provide binding, reason whether egg, psyllium husk/powder, xanthan gum, ground flax/chia gel, or a GF flour blend with binders is needed. Do not assume plain rice flour or cornstarch will bind like wheat gluten.",
      "   - Baking/dough structure: prefer certified gluten-free flour blend; mention xanthan gum or psyllium husk/powder only if the recipe clearly depends on structure (bread, cake, dough, patties) and the blend may not already contain it.",
      "   - For every gluten substitution, update affected step text with practical cooking cues: liquid adjustment, slurry timing, rest/hydration time, heat level, browning risk, or binder requirement when relevant.",
      "7. For dairy, egg, nut, soy, fish, shellfish, and sesame restrictions, do not use generic swaps. Identify the ingredient's role and adjust method/amounts only when the substitute actually works.",
      "8. Add concise warnings to the 'warnings' array in Estonian for active restrictions, label checking, and cross-contact when relevant.",
      "9. Reason whether substitutions realistically exist and are buyable/usable:",
      "   - Do not suggest fantasy products or vague swaps like 'use a gluten-free alternative' without naming a real category.",
      "   - Prefer broadly available categories over brand-only answers.",
      "   - Distinguish common grocery items, specialty-but-realistic items, and uncertain availability.",
      "   - If availability may be limited, say so and provide a fallback method.",
      "   - Explain why each substitution works for the culinary role.",
    );
  }

  lines.push(
    "",
    "═══ ASENDUSED (SUBSTITUTIONS) ═══",
    input.includeSubstitutions || input.activeAllergens.length
      ? [
          "- Provide extra_substitutions for important substitutions you reasoned, especially active allergen replacements.",
          "- Focus on alternatives practically available in Estonian supermarkets (Selver, Prisma, Coop, Rimi).",
          "- Max 1–4 items. Each with 1–4 suggestions in Estonian.",
          "- Use ingredient_in field in English (original ingredient name).",
          "- For technique-sensitive substitutions, note_et must include concrete method or amount guidance when that materially helps the cook, including gluten-free liquid/binder/browning adjustments when relevant.",
          "- note_et must also mention availability confidence when relevant: common grocery item, specialty item, or uncertain availability with fallback.",
        ].join("\n")
      : "- Set extra_substitutions=null.",
    !input.activeAllergens.length && !input.includeSubstitutions ? "- Set warnings=null." : "",
  );

  return lines.filter((l) => l !== undefined).join("\n");
}

function buildInstructionsEn(input: TranslateInput): string {
  const lines: string[] = [
    "You are a professional recipe translator and adaptation chef. Produce natural, idiomatic American English cooking language.",
    "Output ONLY valid JSON matching the schema. No markdown, no extra keys.",
    `AI task type: ${input.taskType}.`,
    "",
    "RULES:",
    "- Use standard US cooking terminology and measurements as given.",
    "- Use decimal dot (not comma).",
    "- Keep array lengths and element order EXACTLY as input.",
    "- Do NOT invent unrelated ingredients or steps.",
    "- Translate/adapt source cooking terms to their correct English equivalents.",
    "- Title: use natural English dish naming conventions.",
    "- Preserve the selected measurement convention from the input payload. Only change quantities when an active allergen substitution requires a real functional ratio change.",
  ];

  if (input.activeAllergens.length) {
    lines.push(
      "",
      "ALLERGEN / DIETARY ADAPTATION MODE (ACTIVE):",
      `- Active restrictions: ${input.activeAllergens.join(", ")}.`,
      "- Local code provides detected risks and culinary-role context only. YOU must reason the actual substitutions and recipe-guide changes.",
      "- Keep ingredient and step array lengths/order exactly the same, but update the corresponding line text when a substitution changes the ingredient or method.",
      "- Ingredient lines must include replacement amounts when a reliable functional ratio can be reasoned.",
      "- If exact amounts cannot be safely reasoned, give a cautious ratio/method note in extra_substitutions.note_et.",
      "- For celiac/gluten, never claim safety without certified gluten-free labels and include cross-contamination warnings.",
      "- If a safe or workable substitution is uncertain, warn instead of guessing.",
      "- For gluten-free sauce thickening, reason whether the flour is used as a roux, slurry, coating, or body. Gluten-free flour blends often need less flour or slightly more liquid because they absorb differently; starches thicken quickly and can turn gluey if overcooked.",
      "- For cornstarch or potato starch, use about half as much as wheat flour, mix with cold liquid first, add near the end, and simmer briefly only until thickened.",
      "- For roux-style sauces, use a certified gluten-free all-purpose flour blend for a similar roux method, or explain that starch should be added later as a slurry with liquid/body adjustments.",
      "- For gluten-free breadcrumbs or starch coatings, warn when they may brown or burn faster and adjust heat/time guidance where relevant.",
      "- For patties, fritters, meatballs, doughs, or baked goods, reason whether a binder is needed: xanthan gum, psyllium husk/powder, egg, flax/chia gel, or a certified gluten-free flour blend that already contains binders. Do not assume plain rice flour or cornstarch binds like wheat gluten.",
      "- For every gluten substitution, update affected step text with practical cooking cues: liquid adjustment, slurry timing, rest/hydration time, heat level, browning risk, or binder requirement when relevant.",
      "- Reason whether substitutions realistically exist and are buyable/usable. Do not suggest fantasy products or vague swaps.",
      "- Prefer broadly available categories over brand-only answers, and give a fallback if availability may be limited.",
      "- For celiac/gluten, say certified/labeled gluten-free where relevant.",
      "- For soy allergy, never suggest tamari because tamari is still soy.",
    );
  }

  lines.push(
    "",
    "SUBSTITUTIONS:",
    input.includeSubstitutions || input.activeAllergens.length
      ? [
          "- Provide extra_substitutions for important substitutions you reasoned. Max 1–4 items, practical alternatives.",
          "- Include concrete method or amount guidance in note_et for technique-sensitive substitutions, including gluten-free liquid/binder/browning adjustments when relevant.",
          "- Include realistic availability notes in note_et when useful: common grocery item, specialty item, or uncertain availability with fallback.",
        ]
          .filter(Boolean)
          .join("\n")
      : "- Set extra_substitutions=null.",
    !input.activeAllergens.length && !input.includeSubstitutions ? "- Set warnings=null." : "",
  );

  return lines.filter((l) => l !== undefined).join("\n");
}

export function buildInstructions(input: TranslateInput): string {
  return input.targetLanguage === "et"
    ? buildInstructionsEt(input)
    : buildInstructionsEn(input);
}

export function buildTranslateCacheIdentity(input: TranslateInput): Record<string, unknown> {
  return {
    source_url: input.source_url,
    taskType: input.taskType,
    title_in: input.title_in,
    ingredients_in: input.ingredients_in,
    steps_in: input.steps_in,
    includeSubstitutions: input.includeSubstitutions,
    activeAllergens: input.activeAllergens,
    measurementPreference: input.measurementPreference,
    targetLanguage: input.targetLanguage,
    allergenContext: input.allergenContext,
    model: input.model,
  };
}

export async function translateToEtCached(input: TranslateInput): Promise<{ result: TranslateResultEt; cacheHit: boolean }> {
  const cacheKeyRaw = JSON.stringify(buildTranslateCacheIdentity(input));
  const key = await sha256Hex(cacheKeyRaw);
  const storageKey = `${CACHE_PREFIX}${key}`;
  const cached = (await chrome.storage.local.get([storageKey])) as any;
  if (cached?.[storageKey]) {
    return { result: cached[storageKey] as TranslateResultEt, cacheHit: true };
  }

  const url = "https://api.openai.com/v1/responses";
  const instructions = buildInstructions(input);

  const userPayload: Record<string, unknown> = {
    title_in: input.title_in,
    ingredients_in: input.ingredients_in,
    steps_in: input.steps_in,
    includeSubstitutions: input.includeSubstitutions,
    activeAllergens: input.activeAllergens,
    measurementPreference: input.measurementPreference,
    targetLanguage: input.targetLanguage,
    taskType: input.taskType,
  };
  if (input.taskType === "allergen_adaptation" && input.allergenContext.length) userPayload.allergenContext = input.allergenContext;

  const reasoningEffort = reasoningForTask(input.taskType);
  const contentBudget = 1500 + input.ingredients_in.length * 40 + input.steps_in.length * 120;
  const reasoningOverhead = reasoningEffort === "medium" ? 6000 : 3000;

  const bodyBase: any = {
    model: input.model,
    instructions,
    input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(userPayload) }] }],
    store: false,
    reasoning: { effort: reasoningEffort },
    text: {
      format: { type: "json_schema", name: "TranslateResult", strict: true, schema: TRANSLATE_SCHEMA },
    },
    max_output_tokens: Math.min(25000, contentBudget + reasoningOverhead),
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${input.apiKey}`,
          },
          body: JSON.stringify(
            attempt === 0
              ? bodyBase
              : {
                  ...bodyBase,
                  input: [
                    ...bodyBase.input,
                    {
                      role: "user",
                      content: [
                        {
                          type: "input_text",
                          text: "Reminder: return ONLY JSON, no markdown. Preserve array lengths and order exactly.",
                        },
                      ],
                    },
                  ],
                },
          ),
        },
        timeoutForTask(input.taskType),
      );
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`OpenAI viga (${resp.status}): ${text || resp.statusText}`);
      }
      const json = await resp.json();
      const text = extractOutputText(json);
      if (!text) throw new Error("OpenAI vastus on tühi.");
      const parsed = JSON.parse(text);
      const validated = validate(parsed, input.ingredients_in.length, input.steps_in.length);
      await chrome.storage.local.set({ [storageKey]: validated } as any);
      return { result: validated, cacheHit: false };
    } catch (e) {
      lastErr = e;
      if (isAbortError(e)) continue;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function validateSubstitutionsCached(input: SubstitutionValidationInput): Promise<string[]> {
  if (!input.substitutions.length) return [];

  const cacheKeyRaw = JSON.stringify({
    taskType: "validation_only",
    source_url: input.source_url,
    targetLanguage: input.targetLanguage,
    activeAllergens: input.activeAllergens,
    substitutions: input.substitutions,
    relevantIngredients: input.relevantIngredients,
    relevantSteps: input.relevantSteps,
    model: input.model,
  });
  const key = await sha256Hex(cacheKeyRaw);
  const storageKey = `${CACHE_PREFIX}validation:${key}`;
  const cached = (await chrome.storage.local.get([storageKey])) as any;
  if (cached?.[storageKey]) return cached[storageKey] as string[];

  const instructions = [
    "You validate recipe substitutions for allergen safety and realism.",
    "Output ONLY valid JSON matching the schema. No markdown, no extra keys.",
    `Active restrictions: ${input.activeAllergens.join(", ")}.`,
    "Check whether the proposed substitutions are realistic, actually exist as grocery/specialty categories, match the allergen restriction, preserve the culinary role, and avoid unsafe contradictions.",
    "For celiac/gluten, require certified/labeled gluten-free where relevant and flag cross-contamination issues.",
    "For soy allergy, flag any tamari suggestion as unsafe because tamari is soy.",
    "Return warnings only for concrete issues or important caveats. Return null if there are no issues.",
  ].join("\n");

  const userPayload = {
    taskType: "validation_only",
    activeAllergens: input.activeAllergens,
    substitutions: input.substitutions,
    relevantIngredients: input.relevantIngredients,
    relevantSteps: input.relevantSteps,
    targetLanguage: input.targetLanguage,
  };

  const body = {
    model: input.model,
    instructions,
    input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(userPayload) }] }],
    store: false,
    reasoning: { effort: "medium" },
    text: {
      format: { type: "json_schema", name: "SubstitutionValidation", strict: true, schema: VALIDATION_SCHEMA },
    },
    max_output_tokens: 3000,
  };

  const resp = await fetchWithTimeout(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(body),
    },
    timeoutForTask("validation_only"),
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OpenAI validation error (${resp.status}): ${text || resp.statusText}`);
  }
  const json = await resp.json();
  const text = extractOutputText(json);
  if (!text) return [];
  const parsed = JSON.parse(text);
  const warnings = Array.isArray(parsed?.warnings) ? parsed.warnings.filter((x: unknown): x is string => typeof x === "string" && x.trim().length > 0) : [];
  await chrome.storage.local.set({ [storageKey]: warnings } as any);
  return warnings;
}


