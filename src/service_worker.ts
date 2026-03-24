import type { JobStatusState, PopupToWorkerMessage, WorkerToPopupMessage, RecipeEtResult } from "./shared_types";
import { parseAllIngredientLines } from "./ingredient_parser";
import { convertParsedIngredientToSystemLine, convertStepsTextForSystem, type MeasurementSystem } from "./unit_converter";
import { applyGlutenFreeDeterministicSubstitutions, postProcessStepsForGlutenFreeSauce } from "./gluten";
import { translateToEtCached } from "./ai_translate";
import { detectLanguageFromTexts, type Lang } from "./language_detect";

type StoredSettings = { openaiApiKey?: string; model?: string };

const DEFAULT_MODEL = "gpt-5.4";

const JOB_KEY = "retseptPdfJobStatus";

function getSessionStorage(): chrome.storage.StorageArea {
  // storage.session may be unavailable in older builds; fallback to local.
  // @ts-expect-error - session exists in MV3 Chrome, but typings may vary.
  return chrome.storage.session ?? chrome.storage.local;
}

async function setJobStatus(patch: Partial<JobStatusState>) {
  const store = getSessionStorage();
  const current = ((await store.get([JOB_KEY])) as any)?.[JOB_KEY] as JobStatusState | undefined;
  const next: JobStatusState = {
    stage: current?.stage ?? "idle",
    message: current?.message ?? "",
    startedAt: current?.startedAt,
    finishedAt: current?.finishedAt,
    error: current?.error,
    ...patch,
  };
  await store.set({ [JOB_KEY]: next } as any);
  chrome.runtime.sendMessage({ type: "JOB_STATUS", payload: { status: next } } satisfies WorkerToPopupMessage).catch(() => {});
}

async function getJobStatus(): Promise<JobStatusState> {
  const store = getSessionStorage();
  const current = ((await store.get([JOB_KEY])) as any)?.[JOB_KEY] as JobStatusState | undefined;
  return (
    current ?? {
      stage: "idle",
      message: "Valmis.",
    }
  );
}

async function ensureOffscreenDocument(): Promise<void> {
  // @ts-expect-error - typings vary across @types/chrome versions
  if (chrome.offscreen?.hasDocument && (await chrome.offscreen.hasDocument())) return;
  // @ts-expect-error - offscreen typings vary
  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL("offscreen.html"),
    reasons: ["BLOBS"],
    justification: "Generate recipe PDF (canvas + jsPDF) in a persistent context even when popup closes.",
  });
}

async function renderAndDownloadPdfInOffscreen(result: RecipeEtResult, heroImageDataUrl: string | undefined, filename: string): Promise<void> {
  await ensureOffscreenDocument();
  const resp = (await chrome.runtime.sendMessage({
    type: "OFFSCREEN_RENDER_PDF_DATAURL",
    payload: { result, heroImageDataUrl },
  })) as any;
  if (!resp?.ok) throw new Error(resp?.error || "PDF renderdamine ebaõnnestus.");
  const dataUrl = resp.dataUrl as string | undefined;
  if (!dataUrl || !dataUrl.startsWith("data:application/pdf")) throw new Error("PDF andme-URL on vigane.");
  // Download in service worker (downloads API is guaranteed here; offscreen may not have it).
  await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
}

function bytesToBase64(bytes: Uint8Array): string {
  // MV3 service worker: use btoa on binary string chunks.
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function fetchImageDataUrl(url: string): Promise<string | undefined> {
  try {
    const resp = await fetch(url, {
      method: "GET",
      // credentials omitted; avoid leaking cookies cross-site
      credentials: "omit",
      redirect: "follow",
      headers: {
        Accept: "image/*,*/*;q=0.8",
      },
    });
    if (!resp.ok) return undefined;

    const contentType = resp.headers.get("content-type") || "application/octet-stream";
    const buf = await resp.arrayBuffer();
    // Guard against very large images.
    if (buf.byteLength > 6_000_000) return undefined;

    const b64 = bytesToBase64(new Uint8Array(buf));
    return `data:${contentType};base64,${b64}`;
  } catch {
    return undefined;
  }
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function mergeSubstitutions(
  deterministic: Array<{ ingredient: string; suggestions_et: string[]; note_et?: string; deterministic: boolean }>,
  extra: Array<{ ingredient_en: string; suggestions_et: string[]; note_et?: string }> | undefined,
): RecipeEtResult["substitutions"] {
  const out: RecipeEtResult["substitutions"] = [];
  const seen = new Set<string>();
  for (const s of deterministic) {
    const key = (s.ingredient || "").toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push({ ingredient: s.ingredient, suggestions_et: s.suggestions_et, note_et: s.note_et });
    }
  }
  for (const s of extra ?? []) {
    const key = (s.ingredient_en || "").toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push({ ingredient: s.ingredient_en, suggestions_et: s.suggestions_et, note_et: s.note_et });
    }
  }
  return out;
}

chrome.runtime.onMessage.addListener((msg: PopupToWorkerMessage, _sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || typeof msg !== "object" || !("type" in msg)) return;

      if (msg.type === "GET_JOB_STATUS") {
        const status = await getJobStatus();
        const resp: WorkerToPopupMessage = { type: "JOB_STATUS", payload: { status } };
        sendResponse(resp);
        return;
      }

      if (msg.type === "FETCH_IMAGE_DATAURL") {
        const dataUrl = await fetchImageDataUrl(msg.payload.url);
        const resp: WorkerToPopupMessage = { type: "FETCH_IMAGE_DATAURL_RESULT", payload: { dataUrl } };
        sendResponse(resp);
        return;
      }

      if (msg.type === "START_GENERATE_PDF_JOB") {
        const existing = await getJobStatus();
        if (existing.stage === "ai_processing" || existing.stage === "generating_pdf" || existing.stage === "downloading") {
          const resp: WorkerToPopupMessage = { type: "JOB_STATUS", payload: { status: existing } };
          sendResponse(resp);
          return;
        }

        await setJobStatus({ stage: "ai_processing", message: "Analüüsin koostisosi ja teisendan ühikuid…", startedAt: Date.now(), error: undefined });

        const settings = (await chrome.storage.sync.get([
          "openaiApiKey",
          "model",
          "outputLanguage",
          "measurementSystem",
        ])) as StoredSettings & { outputLanguage?: "et" | "en"; measurementSystem?: MeasurementSystem };
        const apiKey = settings.openaiApiKey || "";
        const model = (msg.payload.model?.trim() || settings.model?.trim() || DEFAULT_MODEL) as string;
        const outputLanguage: "et" | "en" = settings.outputLanguage === "en" ? "en" : "et";
        const measurementSystem: MeasurementSystem = settings.measurementSystem === "imperial" ? "imperial" : "metric";

        const extracted = msg.payload.extracted;
        const source_domain = getDomain(extracted.source_url);
        const heroFetchPromise = extracted.hero_image_url ? fetchImageDataUrl(extracted.hero_image_url) : Promise.resolve(undefined);

        // Local deterministic pipeline
        const parsed = parseAllIngredientLines(extracted.ingredients);
        const convertedSystem0 = parsed.map((p) => convertParsedIngredientToSystemLine(p, measurementSystem));
        const gf = applyGlutenFreeDeterministicSubstitutions(convertedSystem0 as any, msg.payload.glutenFree);

        const ingredients_in = gf.converted.map((x: any) => (x.metric_note_en ? `${x.metric_en} ${x.metric_note_en}` : x.metric_en));
        const steps_in = convertStepsTextForSystem(extracted.steps, measurementSystem);
        const gfFlags = gf.flags.map((f) => `${f.ingredient_en}: ${f.reason}`);
        const gfSubsEt = gf.substitutions.map((s) => ({ ingredient_en: s.ingredient, suggestions_et: s.suggestions_et, note_et: s.note_et }));

        // Decide whether translation is needed
        const srcLang: Lang = detectLanguageFromTexts([extracted.title, ...extracted.ingredients.slice(0, 30), ...extracted.steps.slice(0, 10)]);
        const translateNeeded =
          outputLanguage === "et"
            ? srcLang !== "et" // translate unless already Estonian
            : srcLang === "et"; // only force translation to English when source is Estonian

        let outTitle = extracted.title;
        let outIngredients = ingredients_in;
        let outSteps = steps_in;
        let extraSubs: any[] | undefined;
        let warnings: string[] | undefined;

        if (translateNeeded) {
          await setJobStatus({ stage: "ai_processing", message: outputLanguage === "et" ? "Tõlgin eesti keelde…" : "Translating to English…" });
          const translated = await translateToEtCached({
            model,
            apiKey,
            source_url: extracted.source_url,
            title_in: extracted.title,
            ingredients_in,
            steps_in,
            includeSubstitutions: msg.payload.includeSubstitutions,
            glutenFreeMode: msg.payload.glutenFree,
            targetLanguage: outputLanguage,
            gfFlags,
            gfSubstitutions_et: gfSubsEt,
          });
          outTitle = translated.result.title;
          outIngredients = translated.result.ingredients;
          outSteps = translated.result.steps;
          extraSubs = translated.result.extra_substitutions;
          warnings = translated.result.warnings;
        }

        // Gluten-free sauces: starch thickener suggestion (post-translation so it matches output language).
        outSteps = postProcessStepsForGlutenFreeSauce(outSteps, convertedSystem0 as any, outputLanguage, msg.payload.glutenFree);

        const warnings_out = [...(warnings ?? [])];
        // If GF mode but model didn't return warnings, add a minimal deterministic safety note.
        if (msg.payload.glutenFree && warnings_out.length === 0) {
          warnings_out.push(
            outputLanguage === "et"
              ? "Kontrolli alati pakendi märgistust: „gluteenivaba“ ning väldi ristsaastumist."
              : "Always check labels for “gluten-free” and avoid cross-contamination.",
          );
        }

        const deterministicSubs = gf.substitutions;
        const subs =
          msg.payload.includeSubstitutions || msg.payload.glutenFree
            ? mergeSubstitutions(deterministicSubs, (extraSubs as any) ?? [])
            : [];

        const result: RecipeEtResult = {
          title_et: outTitle,
          source_url: extracted.source_url,
          source_domain,
          servings: extracted.servings,
          times: extracted.times,
          hero_image_url: extracted.hero_image_url,
          ingredients: extracted.ingredients.map((orig, i) => ({
            original: orig,
            et: outIngredients[i] ?? orig,
          })),
          steps: extracted.steps.map((orig, i) => ({
            original: orig,
            et: outSteps[i] ?? orig,
          })),
          substitutions: subs,
          warnings_et: warnings_out.length ? warnings_out : undefined,
        };

        await setJobStatus({ stage: "generating_pdf", message: "Genereerin PDF-i…" });
        const heroDataUrl = await heroFetchPromise;
        const safeName = (result.title_et || "retsept").toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60);
        const filename = `retsept-${safeName || "retsept"}.pdf`;
        await setJobStatus({ stage: "downloading", message: "Laen PDF-i alla…" });
        await renderAndDownloadPdfInOffscreen(result, heroDataUrl, filename);

        await setJobStatus({ stage: "done", message: "PDF on alla laaditud.", finishedAt: Date.now() });
        const resp: WorkerToPopupMessage = { type: "JOB_STATUS", payload: { status: await getJobStatus() } };
        sendResponse(resp);
        return;
      }

      if (msg.type === "AI_PROCESS_RECIPE") {
        const settings = (await chrome.storage.sync.get([
          "openaiApiKey",
          "model",
          "outputLanguage",
          "measurementSystem",
        ])) as StoredSettings & { outputLanguage?: "et" | "en"; measurementSystem?: MeasurementSystem };
        const apiKey = settings.openaiApiKey || "";
        const model = (msg.payload.model?.trim() || settings.model?.trim() || DEFAULT_MODEL) as string;
        const outputLanguage: "et" | "en" = settings.outputLanguage === "en" ? "en" : "et";
        const measurementSystem: MeasurementSystem = settings.measurementSystem === "imperial" ? "imperial" : "metric";

        // Back-compat: return the (maybe-translated) recipe result without downloading PDF.
        const extracted = msg.payload.extracted;
        const source_domain = getDomain(extracted.source_url);
        const parsed = parseAllIngredientLines(extracted.ingredients);
        const convertedSystem0 = parsed.map((p) => convertParsedIngredientToSystemLine(p, measurementSystem));
        const gf = applyGlutenFreeDeterministicSubstitutions(convertedSystem0 as any, msg.payload.glutenFree);
        const ingredients_in = gf.converted.map((x: any) => (x.metric_note_en ? `${x.metric_en} ${x.metric_note_en}` : x.metric_en));
        const steps_in = convertStepsTextForSystem(extracted.steps, measurementSystem);

        const srcLang: Lang = detectLanguageFromTexts([extracted.title, ...extracted.ingredients.slice(0, 30), ...extracted.steps.slice(0, 10)]);
        const translateNeeded =
          outputLanguage === "et"
            ? srcLang !== "et"
            : srcLang === "et";

        let outTitle = extracted.title;
        let outIngredients = ingredients_in;
        let outSteps = steps_in;
        let extraSubs: any[] | undefined;
        let warnings: string[] | undefined;
        if (translateNeeded) {
          const translated = await translateToEtCached({
            model,
            apiKey,
            source_url: extracted.source_url,
            title_in: extracted.title,
            ingredients_in,
            steps_in,
            includeSubstitutions: msg.payload.includeSubstitutions,
            glutenFreeMode: msg.payload.glutenFree,
            targetLanguage: outputLanguage,
            gfFlags: gf.flags.map((f) => `${f.ingredient_en}: ${f.reason}`),
            gfSubstitutions_et: gf.substitutions.map((s) => ({ ingredient_en: s.ingredient, suggestions_et: s.suggestions_et, note_et: s.note_et })),
          });
          outTitle = translated.result.title;
          outIngredients = translated.result.ingredients;
          outSteps = translated.result.steps;
          extraSubs = translated.result.extra_substitutions;
          warnings = translated.result.warnings;
        }
        const subs =
          msg.payload.includeSubstitutions || msg.payload.glutenFree
            ? mergeSubstitutions(gf.substitutions, (extraSubs as any) ?? [])
            : [];
        const result: RecipeEtResult = {
          title_et: outTitle,
          source_url: extracted.source_url,
          source_domain,
          servings: extracted.servings,
          times: extracted.times,
          hero_image_url: extracted.hero_image_url,
          ingredients: extracted.ingredients.map((orig, i) => ({ original: orig, et: outIngredients[i] ?? orig })),
          steps: extracted.steps.map((orig, i) => ({ original: orig, et: outSteps[i] ?? orig })),
          substitutions: subs,
          warnings_et: warnings,
        };
        const resp: WorkerToPopupMessage = { type: "AI_PROCESS_RECIPE_RESULT", payload: { result } };
        sendResponse(resp);
        return;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await setJobStatus({ stage: "error", message: "Tekkis viga.", error: message, finishedAt: Date.now() }).catch(() => {});
      const resp: WorkerToPopupMessage =
        msg?.type === "FETCH_IMAGE_DATAURL"
          ? { type: "FETCH_IMAGE_DATAURL_ERROR", payload: { message } }
          : { type: "AI_PROCESS_RECIPE_ERROR", payload: { message } };
      sendResponse(resp);
    }
  })();

  // Keep message channel open for async response.
  return true;
});


