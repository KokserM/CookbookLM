import type { ExtractedRecipe, RecipeEtResult } from "./shared_types";

type OpenAIResponsesResponse = any;

const RECIPE_ET_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  // Note: OpenAI's strict JSON-schema validation requires that for any object schema with `properties`,
  // you must supply a `required` array that includes *every* key in `properties`.
  // We keep optionality by allowing `null` for optional fields and then normalizing nulls away in code.
  required: [
    "title_et",
    "source_url",
    "source_domain",
    "servings",
    "times",
    "hero_image_url",
    "ingredients",
    "steps",
    "substitutions",
    "warnings_et",
  ],
  properties: {
    title_et: { type: "string" },
    source_url: { type: "string" },
    source_domain: { type: "string" },
    servings: { type: ["string", "null"] },
    times: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["prep", "cook", "total"],
      properties: {
        prep: { type: ["string", "null"] },
        cook: { type: ["string", "null"] },
        total: { type: ["string", "null"] },
      },
    },
    hero_image_url: { type: ["string", "null"] },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["original", "et", "metric_notes"],
        properties: {
          original: { type: "string" },
          et: { type: "string" },
          metric_notes: { type: ["string", "null"] },
        },
      },
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["original", "et"],
        properties: {
          original: { type: "string" },
          et: { type: "string" },
        },
      },
    },
    substitutions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ingredient", "suggestions_et", "note_et"],
        properties: {
          ingredient: { type: "string" },
          suggestions_et: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
          note_et: { type: ["string", "null"] },
        },
      },
    },
    warnings_et: { type: ["array", "null"], items: { type: "string" } },
  },
} as const;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(input: RequestInfo, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

function isAbortError(e: unknown): boolean {
  // Different runtimes label this differently.
  const anyE: any = e;
  return (
    anyE?.name === "AbortError" ||
    (typeof anyE?.message === "string" && anyE.message.toLowerCase().includes("aborted")) ||
    (typeof anyE?.message === "string" && anyE.message.toLowerCase().includes("abort"))
  );
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function extractTextFromResponsesApi(resp: OpenAIResponsesResponse): string {
  if (typeof resp?.output_text === "string" && resp.output_text.trim()) return resp.output_text;

  // Prefer the first typed output_text block (most reliable for structured outputs).
  const outputs = Array.isArray(resp?.output) ? resp.output : [];
  for (const out of outputs) {
    const content = Array.isArray(out?.content) ? out.content : [];
    for (const c of content) {
      if (c?.type === "output_text" && typeof c?.text === "string" && c.text.trim()) {
        return c.text.trim();
      }
    }
  }

  // Fallback: collect any string-ish fields without duplicating.
  const parts: string[] = [];
  for (const out of outputs) {
    const content = Array.isArray(out?.content) ? out.content : [];
    for (const c of content) {
      const t =
        (typeof c?.output_text === "string" && c.output_text) ||
        (typeof c?.text === "string" && c.text) ||
        "";
      if (t.trim()) parts.push(t.trim());
    }
  }
  return parts.join("\n").trim();
}

function isIncompleteDueToMaxTokens(resp: OpenAIResponsesResponse): boolean {
  const status = resp?.status;
  const reason = resp?.incomplete_details?.reason;
  return status === "incomplete" && reason === "max_output_tokens";
}

function normalizeWhitespace(s: string): string {
  return String(s).replace(/\s+/g, " ").trim();
}

function truncateForModel(s: string, maxChars: number): string {
  const t = normalizeWhitespace(s);
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, maxChars);
  const idx = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "), cut.lastIndexOf(", "), cut.lastIndexOf(" "));
  const safe = (idx > 80 ? cut.slice(0, idx) : cut).trim();
  return `${safe}…`;
}

function strictValidateRecipeEtResult(obj: any): RecipeEtResult {
  if (!obj || typeof obj !== "object") throw new Error("AI: JSON ei ole objekt.");

  // Minimum required keys (we normalize nullable optional fields afterwards).
  const requiredMin = ["title_et", "source_url", "source_domain", "ingredients", "steps", "substitutions"] as const;
  for (const k of requiredMin) if (!(k in obj)) throw new Error(`AI: puudub väli "${k}".`);

  // No extra keys (best-effort).
  const allowed = new Set([
    "title_et",
    "source_url",
    "source_domain",
    "servings",
    "times",
    "hero_image_url",
    "ingredients",
    "steps",
    "substitutions",
    "warnings_et",
  ]);
  for (const k of Object.keys(obj)) if (!allowed.has(k)) throw new Error(`AI: lubamatu lisaväli "${k}".`);

  return obj as RecipeEtResult;
}

function normalizeNullableRecipe(obj: any): RecipeEtResult {
  const out: any = { ...obj };

  const dropIfNullOrEmpty = (k: string) => {
    if (!(k in out)) return;
    const v = out[k];
    if (v === null) delete out[k];
    if (typeof v === "string" && v.trim() === "") delete out[k];
    if (Array.isArray(v) && v.length === 0) delete out[k];
  };

  // Optional top-level fields
  dropIfNullOrEmpty("servings");
  dropIfNullOrEmpty("hero_image_url");
  dropIfNullOrEmpty("warnings_et");

  // times: if all null/empty -> remove; else remove null subkeys (matches interface optional subkeys)
  if (out.times && typeof out.times === "object") {
    const t: any = { ...out.times };
    for (const k of ["prep", "cook", "total"]) {
      if (t[k] === null) delete t[k];
      if (typeof t[k] === "string" && t[k].trim() === "") delete t[k];
    }
    if (Object.keys(t).length === 0) delete out.times;
    else out.times = t;
  } else if (out.times === null) {
    delete out.times;
  }

  // ingredients: drop null/empty metric_notes per line
  if (Array.isArray(out.ingredients)) {
    out.ingredients = out.ingredients.map((ing: any) => {
      const i = { ...ing };
      if (i.metric_notes === null) delete i.metric_notes;
      if (typeof i.metric_notes === "string" && i.metric_notes.trim() === "") delete i.metric_notes;
      return i;
    });
  }

  // substitutions: drop null/empty note_et
  if (Array.isArray(out.substitutions)) {
    out.substitutions = out.substitutions.map((s: any) => {
      const x = { ...s };
      if (x.note_et === null) delete x.note_et;
      if (typeof x.note_et === "string" && x.note_et.trim() === "") delete x.note_et;
      return x;
    });
  }

  return out as RecipeEtResult;
}

export type OpenAiRecipeRequest = {
  extracted: ExtractedRecipe;
  includeSubstitutions: boolean;
  glutenFree: boolean;
  model: string;
};

export async function callOpenAiForRecipeEt(
  apiKey: string,
  req: OpenAiRecipeRequest,
): Promise<RecipeEtResult> {
  if (!apiKey?.trim()) throw new Error("OpenAI API võti puudub. Ava Seaded ja lisa võti.");

  const { extracted, includeSubstitutions, glutenFree, model } = req;

  const system = [
    "You are a careful cooking assistant.",
    "Return ONLY valid JSON that EXACTLY matches the provided JSON schema.",
    "No markdown. No code fences. No extra keys. Preserve meaning and order.",
  ].join("\n");

  const developerGlutenFree = [
    "Gluten-free adaptation (when glutenFree=true):",
    "- Detect gluten-containing ingredients AND hidden gluten sources: wheat/nisu, barley/oder, rye/rukis, spelt/spelta, semolina/manna, couscous, bulgur, breadcrumbs/riivsai, malt extract, many soy sauces, beer, some baking powders, etc.",
    "- Rewrite the recipe to be safe for celiac: replace these with widely available gluten-free alternatives in Estonia/Europe.",
    "- Examples of substitutions to use (pick the best match):",
    "  - nisujahu/spelta -> gluteenivaba universaaljahu segu (nt Schär Mix It, Bauckhof, Vilma GF) OR riisijahu + tärklis (kartuli-/maisitärklis) depending on dish",
    "  - riivsai -> gluteenivaba riivsai / jahvatatud GF krõbe sai",
    "  - sojakaste -> tamari (gluteenivaba) or gluteenivaba sojakaste",
    "  - odralinnase ekstrakt -> gluteenivaba magusaine/siirup (nt riisisiirup) where applicable",
    "- If the recipe is baking and structure might change, add a short warning to warnings_et (e.g. texture may differ).",
    "- Keep the recipe practical: avoid exotic ingredients; prefer products available in EU/Estonia.",
  ].join("\n");

  const developer = [
    "Task: Translate ingredients and directions to natural, idiomatic Estonian; convert imperial -> metric; propose practical substitutions for EU/Estonia.",
    "",
    `glutenFree=${glutenFree ? "true" : "false"}`,
    ...(glutenFree ? ["", developerGlutenFree] : []),
    "",
    "Hard conversion rules (ALWAYS apply when present in ingredient lines or steps):",
    "- lb -> g (1 lb = 453.592 g)",
    "- oz -> g (1 oz = 28.3495 g)",
    "- fl oz -> ml (1 fl oz = 29.5735 ml)",
    "- tsp -> ml (5 ml) AND use Estonian unit abbreviation: tl",
    "- tbsp -> ml (15 ml) AND use Estonian unit abbreviation: sl",
    "- cup -> ml (240 ml default). If ingredient-specific cup->grams is unknown, keep in ml and optionally add metric_notes in Estonian: \"(maht ml; täpne kaal sõltub koostisosast)\"",
    "- °F -> °C using (F-32)*5/9, rounded sensibly (typically to whole °C).",
    "",
    "Estonian style rules:",
    "- Use common Estonian cooking vocabulary and natural phrasing.",
    "- Keep metric units: g, kg, ml, l, tl, sl, °C.",
    "- Keep step order exactly. Don't invent missing steps.",
    "",
    "Substitutions rules:",
    "- Only if includeSubstitutions=true; otherwise return substitutions: [].",
    "- If glutenFree=true, prioritize substitutions for gluten-containing / replaced ingredients (can be fewer total).",
    "- For each non-standard ingredient, suggest 1–3 practical alternatives available in Estonia/Europe.",
    "- Keep suggestions short, in Estonian.",
    "",
    "Output JSON must match interface RecipeEtResult exactly, and include the provided source_url and source_domain.",
    "",
    "IMPORTANT OUTPUT RULES:",
    "- Output MUST follow the provided JSON schema.",
    "- If an optional field is unknown/unavailable, output null (not an empty string).",
    "- For times, output an object with keys prep/cook/total; set unknown ones to null.",
    "- For ingredient.metric_notes and substitution.note_et, use null when not needed.",
    "- For warnings_et, use null if there are no warnings.",
  ].join("\n");

  const source_domain = getDomain(extracted.source_url);

  // Deterministic size control: keep inputs (and therefore echoed `original` outputs) bounded.
  // This prevents max_output_tokens failures on long recipes.
  const compactExtracted: ExtractedRecipe = {
    ...extracted,
    title: truncateForModel(extracted.title, 140),
    ingredients: extracted.ingredients.map((x) => truncateForModel(x, 220)),
    steps: extracted.steps.map((x) => truncateForModel(x, 520)),
  };

  const userPayload = {
    ...compactExtracted,
    source_domain,
    includeSubstitutions,
    glutenFree,
  };

  // Heuristic: allocate more output tokens for longer recipes to avoid truncation.
  // Cap to a reasonable value to avoid runaway cost.
  const estimatedOutputTokens = Math.min(
    12000,
    1400 +
      compactExtracted.ingredients.length * 40 +
      compactExtracted.steps.length * 120 +
      (includeSubstitutions ? compactExtracted.ingredients.length * 18 : 0) +
      (glutenFree ? 800 : 0),
  );

  const instructions = `${system}\n\n${developer}`;

  const baseBody = {
    model,
    // Responses API: put system/developer guidance into top-level instructions,
    // and use typed input content blocks.
    instructions,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify(userPayload) }],
      },
    ],
    // We don't want request/response stored by default.
    store: false,
    // Increase reasoning for gluten-free adaptation (more constrained, safety-critical).
    reasoning: { effort: glutenFree ? "medium" : "none" },
    // Responses API (current): structured output moved from `response_format` -> `text.format`.
    text: {
      format: {
        type: "json_schema",
        // Newer API shape requires name at `text.format.name`
        name: "RecipeEtResult",
        strict: true,
        schema: RECIPE_ET_RESULT_JSON_SCHEMA,
      },
      // Encourage shorter phrasing while keeping completeness (helps avoid truncation).
      verbosity: "low",
    },
    // Keep outputs concise but complete; PDF rendering handles layout.
    max_output_tokens: estimatedOutputTokens,
  };

  const url = "https://api.openai.com/v1/responses";

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const maxTokensThisAttempt =
        attempt === 0
          ? estimatedOutputTokens
          : attempt === 1
            ? Math.min(14000, Math.max(estimatedOutputTokens + 1800, Math.floor(estimatedOutputTokens * 1.5)))
            : Math.min(18000, Math.max(estimatedOutputTokens + 3600, Math.floor(estimatedOutputTokens * 2.0)));

      // Timeout: gluten-free runs can take longer (more constrained rewrite + checks).
      const timeoutMs =
        attempt === 0
          ? glutenFree
            ? 150_000
            : 75_000
          : attempt === 1
            ? glutenFree
              ? 210_000
              : 120_000
            : glutenFree
              ? 270_000
              : 180_000;

      const resp = await fetchWithTimeout(
        url,
        {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
          body: JSON.stringify({
            ...baseBody,
            max_output_tokens: maxTokensThisAttempt,
            input:
              attempt === 0
                ? baseBody.input
                : [
                    ...baseBody.input,
                    {
                      role: "user",
                      content: [
                        {
                          type: "input_text",
                          text: "Reminder: Output MUST be ONLY valid JSON (no markdown), with no extra keys, matching the schema exactly. Keep wording concise.",
                        },
                      ],
                    },
                  ],
          }),
        },
        timeoutMs,
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`OpenAI viga (${resp.status}): ${text || resp.statusText}`);
      }

      const json = (await resp.json()) as OpenAIResponsesResponse;
      if (isIncompleteDueToMaxTokens(json)) {
        if (attempt < 2) {
          throw new Error("OpenAI vastus jäi pooleli (max_output_tokens). Proovin uuesti suurema piiranguga…");
        }
        throw new Error(
          "OpenAI vastus jäi ikka pooleli (max_output_tokens). See retsept on väga pikk. Proovi lülitada välja „Lisa asendused“ või „Gluteenivaba“, või proovi teist mudelit.",
        );
      }
      const text = extractTextFromResponsesApi(json);
      if (!text) throw new Error("OpenAI vastus on tühi.");

      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("OpenAI ei tagastanud kehtivat JSON-i.");
      }

      const validated = strictValidateRecipeEtResult(parsed);
      const normalized = normalizeNullableRecipe(validated);

      // Ensure source_url/domain are preserved (model may copy; we enforce).
      normalized.source_url = extracted.source_url;
      normalized.source_domain = source_domain || normalized.source_domain;

      if (!includeSubstitutions) normalized.substitutions = [];
      return normalized;
    } catch (e) {
      lastErr = e;
      // If we aborted due to timeout, retry (next attempt already uses longer timeout).
      if (isAbortError(e)) {
        await sleep(250 * (attempt + 1));
        continue;
      }
      await sleep(350 * (attempt + 1));
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}



