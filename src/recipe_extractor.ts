import type { ExtractedRecipe } from "./shared_types";

type JsonLd = any;

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function textOrUndefined(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  return undefined;
}

function cleanLine(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/^\s*[-*•]\s+/, "")
    .replace(/^\s*\d+\.\s+/, "")
    .trim();
}

function uniqNonEmpty(lines: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const v = cleanLine(raw);
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function parseIso8601DurationToHuman(v?: string): string | undefined {
  // Accepts PTxHxMxS and PnDTnHnM
  if (!v || typeof v !== "string") return undefined;
  const m = v.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i,
  );
  if (!m) return v;
  const d = m[1] ? Number(m[1]) : 0;
  const h = m[2] ? Number(m[2]) : 0;
  const min = m[3] ? Number(m[3]) : 0;
  const s = m[4] ? Number(m[4]) : 0;
  const parts: string[] = [];
  if (d) parts.push(`${d} d`);
  if (h) parts.push(`${h} h`);
  if (min) parts.push(`${min} min`);
  if (s && !parts.length) parts.push(`${s} s`);
  return parts.join(" ");
}

function isRecipeType(t: unknown): boolean {
  if (typeof t === "string") return t.toLowerCase().includes("recipe");
  if (Array.isArray(t)) return t.some(isRecipeType);
  return false;
}

function flattenJsonLdCandidates(node: JsonLd): JsonLd[] {
  const out: JsonLd[] = [];
  const visit = (n: JsonLd) => {
    if (!n) return;
    if (Array.isArray(n)) return n.forEach(visit);
    if (typeof n !== "object") return;
    out.push(n);
    if (n["@graph"]) visit(n["@graph"]);
  };
  visit(node);
  return out;
}

function pickBestRecipeNode(nodes: JsonLd[]): JsonLd | undefined {
  const recipes = nodes.filter((n) => isRecipeType(n["@type"]));
  if (!recipes.length) return undefined;
  const score = (r: JsonLd): number => {
    let s = 0;
    if (r.name) s += 3;
    if (r.recipeIngredient) s += 3;
    if (r.recipeInstructions) s += 3;
    if (r.image) s += 1;
    if (r.recipeYield) s += 1;
    if (r.totalTime || r.cookTime || r.prepTime) s += 1;
    return s;
  };
  return recipes.sort((a, b) => score(b) - score(a))[0];
}

function extractInstructionsFromJsonLd(instr: any): string[] {
  // Can be string, array of strings, HowToStep, HowToSection.
  const out: string[] = [];
  const visit = (v: any) => {
    if (!v) return;
    if (typeof v === "string") {
      out.push(...v.split(/\r?\n+/).map((x) => x.trim()).filter(Boolean));
      return;
    }
    if (Array.isArray(v)) return v.forEach(visit);
    if (typeof v === "object") {
      if (typeof v.text === "string") return visit(v.text);
      if (v.itemListElement) return visit(v.itemListElement);
      if (v.steps) return visit(v.steps);
      if (v["@type"] && String(v["@type"]).toLowerCase().includes("howtosection") && v.name) {
        // include section header lightly
        out.push(String(v.name).trim());
      }
      if (v["@type"] && String(v["@type"]).toLowerCase().includes("howtostep") && v.name) {
        out.push(String(v.name).trim());
      }
    }
  };
  visit(instr);
  return uniqNonEmpty(out);
}

function extractImageUrlFromJsonLd(image: any): string | undefined {
  if (!image) return undefined;
  if (typeof image === "string") return image;
  if (Array.isArray(image)) {
    for (const v of image) {
      const u = extractImageUrlFromJsonLd(v);
      if (u) return u;
    }
  }
  if (typeof image === "object") {
    return textOrUndefined(image.url) || textOrUndefined(image.contentUrl);
  }
  return undefined;
}

function tryExtractFromJsonLd(doc: Document, url: string): ExtractedRecipe | null {
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  const candidates: JsonLd[] = [];
  for (const s of scripts) {
    const txt = s.textContent?.trim();
    if (!txt) continue;
    try {
      const parsed = JSON.parse(txt);
      candidates.push(...flattenJsonLdCandidates(parsed));
    } catch {
      // Some sites embed multiple JSON-LD blocks with trailing commas, etc. Skip silently.
    }
  }
  const recipe = pickBestRecipeNode(candidates);
  if (!recipe) return null;

  const title = textOrUndefined(recipe.name) ?? doc.title ?? "Retsept";
  const ingredients = uniqNonEmpty(asArray(recipe.recipeIngredient).map(String));
  const steps = extractInstructionsFromJsonLd(recipe.recipeInstructions);

  if (!ingredients.length && !steps.length) return null;

  const servings =
    textOrUndefined(recipe.recipeYield) ||
    textOrUndefined(recipe.yield) ||
    textOrUndefined(recipe.recipeServings);

  const times = {
    prep: parseIso8601DurationToHuman(textOrUndefined(recipe.prepTime)),
    cook: parseIso8601DurationToHuman(textOrUndefined(recipe.cookTime)),
    total: parseIso8601DurationToHuman(textOrUndefined(recipe.totalTime)),
  };

  const hero_image_url = extractImageUrlFromJsonLd(recipe.image) || extractOgImage(doc);

  return {
    title,
    source_url: url,
    servings: servings || undefined,
    times: times.prep || times.cook || times.total ? times : undefined,
    hero_image_url,
    ingredients,
    steps,
  };
}

function extractOgImage(doc: Document): string | undefined {
  const og = doc.querySelector('meta[property="og:image"], meta[name="og:image"]') as HTMLMetaElement | null;
  const c = og?.content?.trim();
  return c || undefined;
}

function extractOgTitle(doc: Document): string | undefined {
  const og = doc.querySelector('meta[property="og:title"], meta[name="og:title"]') as HTMLMetaElement | null;
  const c = og?.content?.trim();
  return c || undefined;
}

function firstText(el: Element | null | undefined): string | undefined {
  if (!el) return undefined;
  const t = (el as HTMLElement).innerText || el.textContent || "";
  const cleaned = cleanLine(t);
  return cleaned || undefined;
}

function queryTextList(doc: Document, selectors: string[]): string[] {
  for (const sel of selectors) {
    const nodes = Array.from(doc.querySelectorAll(sel));
    const texts = nodes
      .map((n) => firstText(n))
      .filter((x): x is string => Boolean(x));
    const cleaned = uniqNonEmpty(texts);
    if (cleaned.length >= 3) return cleaned;
  }
  return [];
}

function tryExtractFromMicrodata(doc: Document, url: string): ExtractedRecipe | null {
  const recipeEl = doc.querySelector(
    '[itemscope][itemtype*="schema.org/Recipe"], [itemscope][itemtype*="schema.org/recipe"]',
  );
  if (!recipeEl) return null;

  const title =
    firstText(recipeEl.querySelector('[itemprop="name"]')) || firstText(doc.querySelector("h1")) || doc.title || "Retsept";

  const ingredientNodes = Array.from(recipeEl.querySelectorAll('[itemprop="recipeIngredient"]'));
  const ingredients = uniqNonEmpty(
    ingredientNodes
      .map((n) => (n as HTMLElement).innerText || n.textContent || "")
      .map((s) => String(s)),
  );

  const instrNodes = Array.from(recipeEl.querySelectorAll('[itemprop="recipeInstructions"]'));
  let steps = uniqNonEmpty(
    instrNodes
      .map((n) => (n as HTMLElement).innerText || n.textContent || "")
      .flatMap((s) => String(s).split(/\r?\n+/)),
  );

  // Some microdata nests HowToStep under recipeInstructions
  if (steps.length < 2) {
    const howToStep = Array.from(recipeEl.querySelectorAll('[itemtype*="schema.org/HowToStep"]'));
    steps = uniqNonEmpty(
      howToStep
        .map((n) => firstText(n) || firstText(n.querySelector('[itemprop="text"]')) || "")
        .filter(Boolean),
    );
  }

  if (!ingredients.length && !steps.length) return null;

  const servings =
    firstText(recipeEl.querySelector('[itemprop="recipeYield"]')) ||
    firstText(recipeEl.querySelector('[itemprop="recipeServings"]'));

  const prep = firstText(recipeEl.querySelector('[itemprop="prepTime"]'));
  const cook = firstText(recipeEl.querySelector('[itemprop="cookTime"]'));
  const total = firstText(recipeEl.querySelector('[itemprop="totalTime"]'));

  const hero_image_url =
    (recipeEl.querySelector('[itemprop="image"]') as HTMLImageElement | null)?.src || extractOgImage(doc);

  return {
    title,
    source_url: url,
    servings: servings || undefined,
    times: prep || cook || total ? { prep, cook, total } : undefined,
    hero_image_url: hero_image_url || undefined,
    ingredients,
    steps,
  };
}

function tryExtractFromHeuristics(doc: Document, url: string): ExtractedRecipe | null {
  const title = firstText(doc.querySelector("h1")) || extractOgTitle(doc) || doc.title || "Retsept";

  const ingredients = queryTextList(doc, [
    // Common recipe frameworks
    "[class*='ingredient'] li",
    "[id*='ingredient'] li",
    "ul.ingredients li",
    "section.ingredients li",
    ".ingredients li",
    // Fallback: list items near headings
    "article li[class*='ingredient']",
  ]);

  const steps = queryTextList(doc, [
    "[class*='instruction'] li",
    "[class*='direction'] li",
    "[class*='method'] li",
    "[id*='instruction'] li",
    "ol.instructions li",
    "ol.directions li",
    ".instructions li",
    ".directions li",
    // Sometimes steps are paragraphs
    "[class*='instruction'] p",
    "[class*='direction'] p",
  ]);

  const hero_image_url = extractOgImage(doc);

  if (!ingredients.length && !steps.length) return null;

  return {
    title,
    source_url: url,
    hero_image_url,
    ingredients,
    steps,
  };
}

export function extractRecipeFromDocument(doc: Document, url: string): ExtractedRecipe | null {
  // Prefer structured data sources, then heuristics.
  return (
    tryExtractFromJsonLd(doc, url) ||
    tryExtractFromMicrodata(doc, url) ||
    tryExtractFromHeuristics(doc, url)
  );
}

export function getExtractionDebugSummary(extracted: ExtractedRecipe | null): string {
  if (!extracted) return "no recipe";
  const domain = getDomain(extracted.source_url);
  return `${domain}: title="${extracted.title}", ingredients=${extracted.ingredients.length}, steps=${extracted.steps.length}`;
}


