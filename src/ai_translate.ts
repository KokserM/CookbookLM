import type { TranslateResultEt } from "./shared_types";

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
  model: string;
  apiKey: string;
  source_url: string;
  title_in: string;
  ingredients_in: string[];
  steps_in: string[];
  includeSubstitutions: boolean;
  glutenFreeMode: boolean;
  targetLanguage: "et" | "en";
  gfFlags: string[]; // short strings
  gfSubstitutions_et: Array<{ ingredient_en: string; suggestions_et: string[]; note_et?: string }>;
};

function buildInstructionsEt(input: TranslateInput): string {
  const lines: string[] = [
    "You are an expert Estonian culinary translator who writes like a native Estonian cookbook author.",
    "Your task: translate the English recipe into natural, idiomatic Estonian as it would appear in a professional Estonian cookbook (e.g. Nõo Lihatööstuse kokaraamat, Ene Rõtmani retseptid).",
    "Output ONLY valid JSON matching the schema. No markdown, no commentary, no extra keys.",
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
    "- Do NOT change quantities or units — only format decimal comma (1.5 → 1,5).",
    "- Do NOT invent ingredients, steps, or information not present in the source.",
    "- Preserve parenthetical notes, translate them naturally: '(about 2 cups)' → '(umbes 480 ml)'.",
  ];

  if (input.glutenFreeMode) {
    lines.push(
      "",
      "═══ GLUTEENIVABA REŽIIM (AKTIIVNE) ═══",
      "The ingredient lines already have deterministic GF swaps applied (e.g. 'gluten-free flour blend').",
      "Your tasks in GF mode:",
      "1. Translate GF ingredient names into natural Estonian: 'gluten-free flour blend' → 'gluteenivaba jahusegu', 'tamari (gluten-free)' → 'tamari (gluteenivaba)'.",
      "2. In steps, if the original mentions flour for thickening/coating/binding, translate using the GF term the ingredients already specify.",
      "3. REASON about achieving the same culinary result with GF ingredients:",
      "   - Baking rise/structure: GF jahusegu may need ksantaankummi; mention if recipe involves yeast bread or cake.",
      "   - Thickening sauces: maisitärklis/kartulitärklis at ~half wheat flour amount.",
      "   - Coating/breading: GF riivsaiad or purustatud maisihelbed for crunch.",
      "   - Binding: munad, linaseemne 'munad', GF kaer.",
      "4. Add 3–5 concise warnings to the 'warnings' array in Estonian:",
      "   - Ristsaastumise oht: kasuta eraldi lõikelaudu, pannid ja tööriistu.",
      '   - Kontrolli KÕIKI pakendimärgistusi — "gluteenivaba" sertifikaat peab olema.',
      "   - Kaeratooted peavad olema sertifitseeritud gluteenivabad (tavakaerahelbeid ei tohi kasutada).",
      "   - Add 1–2 recipe-specific warnings based on which GF ingredients appear.",
    );
  }

  lines.push(
    "",
    "═══ ASENDUSED (SUBSTITUTIONS) ═══",
    input.includeSubstitutions
      ? [
          "- Provide extra_substitutions ONLY for ingredients NOT already covered by gfSubstitutions_et.",
          "- Focus on alternatives practically available in Estonian supermarkets (Selver, Prisma, Coop, Rimi).",
          "- Max 1–4 items. Each with 1–4 suggestions in Estonian.",
          "- Use ingredient_in field in English (original ingredient name).",
        ].join("\n")
      : "- Set extra_substitutions=null.",
    !input.glutenFreeMode && !input.includeSubstitutions ? "- Set warnings=null." : "",
  );

  return lines.filter((l) => l !== undefined).join("\n");
}

function buildInstructionsEn(input: TranslateInput): string {
  const lines: string[] = [
    "You are a professional recipe translator. Translate this Estonian recipe to natural, idiomatic American English cooking language.",
    "Output ONLY valid JSON matching the schema. No markdown, no extra keys.",
    "",
    "RULES:",
    "- Use standard US cooking terminology and measurements as given.",
    "- Use decimal dot (not comma).",
    "- Keep array lengths and element order EXACTLY as input.",
    "- Do NOT invent ingredients or steps.",
    "- Translate Estonian cooking terms to their correct English equivalents.",
    "- Title: use natural English dish naming conventions.",
  ];

  if (input.glutenFreeMode) {
    lines.push(
      "",
      "GLUTEN-FREE MODE (ACTIVE):",
      "- Translate GF ingredient names naturally.",
      "- Add 3–5 concise safety warnings in English about cross-contamination, label checking, etc.",
    );
  }

  lines.push(
    "",
    "SUBSTITUTIONS:",
    input.includeSubstitutions
      ? "- Provide extra_substitutions for ingredients not already covered. Max 1–4 items, practical alternatives."
      : "- Set extra_substitutions=null.",
    !input.glutenFreeMode && !input.includeSubstitutions ? "- Set warnings=null." : "",
  );

  return lines.filter((l) => l !== undefined).join("\n");
}

function buildInstructions(input: TranslateInput): string {
  return input.targetLanguage === "et"
    ? buildInstructionsEt(input)
    : buildInstructionsEn(input);
}

export async function translateToEtCached(input: TranslateInput): Promise<{ result: TranslateResultEt; cacheHit: boolean }> {
  const cacheKeyRaw = JSON.stringify({
    source_url: input.source_url,
    title_in: input.title_in,
    ingredients_in: input.ingredients_in,
    steps_in: input.steps_in,
    includeSubstitutions: input.includeSubstitutions,
    glutenFreeMode: input.glutenFreeMode,
    targetLanguage: input.targetLanguage,
    gfFlags: input.gfFlags,
    gfSubstitutions_et: input.gfSubstitutions_et,
    model: input.model,
  });
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
    glutenFreeMode: input.glutenFreeMode,
    targetLanguage: input.targetLanguage,
  };
  if (input.gfFlags.length) userPayload.gfFlags = input.gfFlags;
  if (input.gfSubstitutions_et.length) userPayload.gfSubstitutions_et = input.gfSubstitutions_et;

  const reasoningEffort = input.glutenFreeMode ? "medium" : "low";
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
        input.glutenFreeMode ? 180_000 : 90_000,
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


