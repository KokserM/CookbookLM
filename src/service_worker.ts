import type { AllergenId, JobStatusState, MeasurementPreference, ModelRoutingMode, PdfPageFormat, PopupToWorkerMessage, WorkerToPopupMessage, RecipeEtResult } from "./shared_types";
import { parseAllIngredientLines } from "./ingredient_parser";
import { convertParsedIngredientToSystemLine, convertStepsTextForSystem } from "./unit_converter";
import { translateToEtCached, validateSubstitutionsCached } from "./ai_translate";
import { detectLanguageFromTexts, type Lang } from "./language_detect";
import { buildAllergenContext, formatAllergenContextForPrompt, normalizeAllergenModes } from "./allergen_context";
import { determineAiTask, selectModelForTask, shouldRunAi, shouldRunValidationPass } from "./ai_routing";

type StoredSettings = { openaiApiKey?: string; model?: string; qualityModel?: string; economyModel?: string; modelRouting?: ModelRoutingMode };

const DEFAULT_MODEL = "gpt-5.4";
const DEFAULT_ECONOMY_MODEL = "gpt-5.1";

const JOB_KEY = "retseptPdfJobStatus";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

function getSessionStorage(): chrome.storage.StorageArea {
  return chrome.storage.session ?? chrome.storage.local;
}

function updateBadge(stage: JobStatusState["stage"]) {
  const action = chrome.action;
  switch (stage) {
    case "ai_processing":
    case "generating_pdf":
      action.setBadgeText({ text: "..." });
      action.setBadgeBackgroundColor({ color: "#2563eb" });
      break;
    case "downloading":
      action.setBadgeText({ text: "PDF" });
      action.setBadgeBackgroundColor({ color: "#16a34a" });
      break;
    case "done":
      action.setBadgeText({ text: "\u2713" });
      action.setBadgeBackgroundColor({ color: "#16a34a" });
      setTimeout(() => action.setBadgeText({ text: "" }), 8000);
      break;
    case "error":
      action.setBadgeText({ text: "!" });
      action.setBadgeBackgroundColor({ color: "#dc2626" });
      setTimeout(() => action.setBadgeText({ text: "" }), 10000);
      break;
    default:
      action.setBadgeText({ text: "" });
  }
}

async function setJobStatus(patch: Partial<JobStatusState>) {
  const store = getSessionStorage();
  const current = ((await store.get([JOB_KEY])) as any)?.[JOB_KEY] as JobStatusState | undefined;
  const next: JobStatusState = {
    stage: current?.stage ?? "idle",
    message: current?.message ?? "",
    ...(current?.startedAt !== undefined ? { startedAt: current.startedAt } : {}),
    ...(current?.finishedAt !== undefined ? { finishedAt: current.finishedAt } : {}),
    ...(current?.error !== undefined ? { error: current.error } : {}),
    ...(current?.recipeTitle !== undefined ? { recipeTitle: current.recipeTitle } : {}),
    ...(current?.sourceUrl !== undefined ? { sourceUrl: current.sourceUrl } : {}),
    ...patch,
  };
  await store.set({ [JOB_KEY]: next } as any);
  updateBadge(next.stage);
  chrome.runtime.sendMessage({ type: "JOB_STATUS", payload: { status: next } } satisfies WorkerToPopupMessage).catch(() => {});
}

async function getJobStatus(): Promise<JobStatusState> {
  const store = getSessionStorage();
  const current = ((await store.get([JOB_KEY])) as any)?.[JOB_KEY] as JobStatusState | undefined;
  return (
    current ?? {
        stage: "idle",
        message: "Ready.",
    }
  );
}

async function ensureOffscreenDocument(): Promise<void> {
  if (chrome.offscreen?.hasDocument && (await chrome.offscreen.hasDocument())) return;
  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL("offscreen.html"),
    reasons: ["BLOBS"],
    justification: "Generate recipe PDF (canvas + jsPDF) in a persistent context even when popup closes.",
  });
}

async function renderAndDownloadPdfInOffscreen(
  result: RecipeEtResult,
  heroImageDataUrl: string | undefined,
  filename: string,
  pageFormat: PdfPageFormat,
  outputLanguage: "et" | "en",
): Promise<void> {
  await ensureOffscreenDocument();
  const resp = (await chrome.runtime.sendMessage({
    type: "OFFSCREEN_RENDER_PDF_DATAURL",
    payload: { result, heroImageDataUrl, options: { pageFormat, language: outputLanguage } },
  })) as any;
  if (!resp?.ok) throw new Error(resp?.error || "PDF rendering failed.");
  const dataUrl = resp.dataUrl as string | undefined;
  if (!dataUrl || !dataUrl.startsWith("data:application/pdf")) throw new Error("PDF data URL is invalid.");
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
  deterministic: Array<{ ingredient: string; suggestions_et: string[]; note_et?: string; deterministic?: boolean }>,
  extra: Array<{ ingredient_en: string; suggestions_et: string[]; note_et?: string }> | undefined,
): RecipeEtResult["substitutions"] {
  const out: RecipeEtResult["substitutions"] = [];
  const seen = new Set<string>();
  for (const s of deterministic) {
    const key = (s.ingredient || "").toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push({
        ingredient: s.ingredient,
        suggestions_et: s.suggestions_et,
        ...(s.note_et ? { note_et: s.note_et } : {}),
      });
    }
  }
  for (const s of extra ?? []) {
    const key = (s.ingredient_en || "").toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push({
        ingredient: s.ingredient_en,
        suggestions_et: s.suggestions_et,
        ...(s.note_et ? { note_et: s.note_et } : {}),
      });
    }
  }
  return out;
}

async function getApiKey(): Promise<string> {
  const local = (await chrome.storage.local.get(["openaiApiKey"])) as StoredSettings;
  if (local.openaiApiKey?.trim()) return local.openaiApiKey.trim();
  const sync = (await chrome.storage.sync.get(["openaiApiKey"])) as StoredSettings;
  if (sync.openaiApiKey?.trim()) {
    await chrome.storage.local.set({ openaiApiKey: sync.openaiApiKey.trim() } as any);
    await chrome.storage.sync.remove(["openaiApiKey"]);
    return sync.openaiApiKey.trim();
  }
  return "";
}

function ensureApiKey(apiKey: string) {
  if (!apiKey) throw new Error("OpenAI API key is missing. Open Settings and add your own key before generating a recipe.");
}

function fallbackWarnings(activeAllergens: AllergenId[], outputLanguage: "et" | "en"): string[] {
  if (!activeAllergens.length) return [];
  if (outputLanguage === "et") {
    return activeAllergens.includes("gluten")
      ? ["Kontrolli alati pakendi märgistust ja kasuta ainult sertifitseeritud gluteenivabu tooteid; väldi ristsaastumist."]
      : ["Kontrolli alati pakendi allergeenimärgistust ja väldi ristsaastumist valitud piirangutega."];
  }
  return activeAllergens.includes("gluten")
    ? ["Always check package labels and use only certified gluten-free products for celiac-safe cooking; avoid cross-contamination."]
    : ["Always check package allergen labels and avoid cross-contact for the selected restrictions."];
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
        const resp: WorkerToPopupMessage = {
          type: "FETCH_IMAGE_DATAURL_RESULT",
          payload: dataUrl ? { dataUrl } : {},
        };
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

        const extracted = msg.payload.extracted;

        await setJobStatus({
          stage: "ai_processing",
          message: "Analyzing recipe and preparing measurements...",
          startedAt: Date.now(),
          recipeTitle: extracted.title,
          sourceUrl: extracted.source_url,
        });

        const apiKey = await getApiKey();
        const settings = (await chrome.storage.sync.get([
          "model",
          "qualityModel",
          "economyModel",
          "modelRouting",
          "outputLanguage",
          "measurementSystem",
          "measurementPreference",
          "pdfPageFormat",
        ])) as StoredSettings & { outputLanguage?: "et" | "en"; measurementSystem?: MeasurementPreference; measurementPreference?: MeasurementPreference; pdfPageFormat?: PdfPageFormat };
        const qualityModel = (msg.payload.model?.trim() || settings.qualityModel?.trim() || settings.model?.trim() || DEFAULT_MODEL) as string;
        const economyModel = (settings.economyModel?.trim() || DEFAULT_ECONOMY_MODEL) as string;
        const modelRouting = settings.modelRouting ?? "balanced";
        const outputLanguage: "et" | "en" = settings.outputLanguage === "et" ? "et" : "en";
        const measurementPreference: MeasurementPreference =
          settings.measurementPreference ?? settings.measurementSystem ?? "metric";
        const pageFormat: PdfPageFormat = settings.pdfPageFormat ?? "a4";
        const activeAllergens = normalizeAllergenModes(msg.payload.allergenModes, msg.payload.glutenFree);
        const source_domain = getDomain(extracted.source_url);
        const heroFetchPromise = extracted.hero_image_url ? fetchImageDataUrl(extracted.hero_image_url) : Promise.resolve(undefined);

        // Local context pipeline. Substitutions are reasoned by the LLM, not locally chosen.
        const parsed = parseAllIngredientLines(extracted.ingredients);
        const convertedSystem0 = parsed.map((p) => convertParsedIngredientToSystemLine(p, measurementPreference));
        const ingredients_in = convertedSystem0.map((x: any) => (x.metric_note_en ? `${x.metric_en} ${x.metric_note_en}` : x.metric_en));
        const steps_in = convertStepsTextForSystem(extracted.steps, measurementPreference);
        const allergenContext = formatAllergenContextForPrompt(buildAllergenContext(convertedSystem0, activeAllergens, steps_in));

        // Decide whether translation is needed
        const srcLang: Lang = detectLanguageFromTexts([extracted.title, ...extracted.ingredients.slice(0, 30), ...extracted.steps.slice(0, 10)]);
        const translateNeeded =
          outputLanguage === "et"
            ? srcLang !== "et" // translate unless already Estonian
            : srcLang === "et"; // only force translation to English when source is Estonian
        const taskType = determineAiTask({ translateNeeded, includeSubstitutions: msg.payload.includeSubstitutions, activeAllergens });
        const aiNeeded = shouldRunAi(taskType);
        const model = selectModelForTask(taskType, { qualityModel, economyModel, modelRouting }, activeAllergens);

        let outTitle = extracted.title;
        let outIngredients = ingredients_in;
        let outSteps = steps_in;
        let extraSubs: any[] | undefined;
        let warnings: string[] | undefined;

        if (aiNeeded) {
          ensureApiKey(apiKey);
          await setJobStatus({
            stage: "ai_processing",
            message:
              taskType === "allergen_adaptation"
                ? "Reasoning allergen-safe substitutions..."
                : taskType === "translate_only"
                  ? "Translating recipe..."
                  : "Processing recipe substitutions...",
          });
          const translated = await translateToEtCached({
            taskType,
            model,
            apiKey,
            source_url: extracted.source_url,
            title_in: extracted.title,
            ingredients_in,
            steps_in,
            includeSubstitutions: msg.payload.includeSubstitutions,
            activeAllergens,
            measurementPreference,
            targetLanguage: outputLanguage,
            allergenContext,
          });
          outTitle = translated.result.title;
          outIngredients = translated.result.ingredients;
          outSteps = translated.result.steps;
          extraSubs = translated.result.extra_substitutions;
          warnings = translated.result.warnings;
          if (shouldRunValidationPass(taskType, activeAllergens, extraSubs?.length ?? 0)) {
            await setJobStatus({ stage: "ai_processing", message: "Checking substitution realism..." });
            const validationModel = selectModelForTask("validation_only", { qualityModel, economyModel, modelRouting }, activeAllergens);
            const validationWarnings = await validateSubstitutionsCached({
              model: validationModel,
              apiKey,
              source_url: extracted.source_url,
              targetLanguage: outputLanguage,
              activeAllergens,
              substitutions: (extraSubs ?? []).map((s) => ({
                ingredient_en: s.ingredient_in,
                suggestions_et: s.suggestions_et,
                ...(s.note_et ? { note_et: s.note_et } : {}),
              })),
              relevantIngredients: ingredients_in,
              relevantSteps: steps_in,
            });
            warnings = [...(warnings ?? []), ...validationWarnings];
          }
        }

        const warnings_out = [...(warnings ?? [])];
        if (activeAllergens.length && warnings_out.length === 0) warnings_out.push(...fallbackWarnings(activeAllergens, outputLanguage));

        const subs =
          msg.payload.includeSubstitutions || activeAllergens.length
            ? mergeSubstitutions([], (extraSubs as any) ?? [])
            : [];

        const result: RecipeEtResult = {
          title_et: outTitle,
          source_url: extracted.source_url,
          source_domain,
          ...(extracted.servings ? { servings: extracted.servings } : {}),
          ...(extracted.times ? { times: extracted.times } : {}),
          ...(extracted.hero_image_url ? { hero_image_url: extracted.hero_image_url } : {}),
          ingredients: extracted.ingredients.map((orig, i) => ({
            original: orig,
            et: outIngredients[i] ?? orig,
          })),
          steps: extracted.steps.map((orig, i) => ({
            original: orig,
            et: outSteps[i] ?? orig,
          })),
          substitutions: subs,
          ...(warnings_out.length ? { warnings_et: warnings_out } : {}),
        };

        await setJobStatus({ stage: "generating_pdf", message: "Formatting PDF..." });
        const heroDataUrl = await heroFetchPromise;
        const safeName = (result.title_et || "recipe").toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60);
        const filename = `recipe-${safeName || "recipe"}.pdf`;
        await setJobStatus({ stage: "downloading", message: "Downloading PDF..." });
        await renderAndDownloadPdfInOffscreen(result, heroDataUrl, filename, pageFormat, outputLanguage);

        await setJobStatus({ stage: "done", message: "PDF downloaded.", finishedAt: Date.now() });

        chrome.notifications.create(`pdf-${Date.now()}`, {
          type: "basic",
          iconUrl: chrome.runtime.getURL("icons/icon128.png"),
          title: "CookbookLM",
          message: `"${result.title_et}" PDF has been downloaded.`,
        });

        const resp: WorkerToPopupMessage = { type: "JOB_STATUS", payload: { status: await getJobStatus() } };
        sendResponse(resp);
        return;
      }

      if (msg.type === "AI_PROCESS_RECIPE") {
        const apiKey = await getApiKey();
        const settings = (await chrome.storage.sync.get([
          "model",
          "qualityModel",
          "economyModel",
          "modelRouting",
          "outputLanguage",
          "measurementSystem",
          "measurementPreference",
        ])) as StoredSettings & { outputLanguage?: "et" | "en"; measurementSystem?: MeasurementPreference; measurementPreference?: MeasurementPreference };
        const qualityModel = (msg.payload.model?.trim() || settings.qualityModel?.trim() || settings.model?.trim() || DEFAULT_MODEL) as string;
        const economyModel = (settings.economyModel?.trim() || DEFAULT_ECONOMY_MODEL) as string;
        const modelRouting = settings.modelRouting ?? "balanced";
        const outputLanguage: "et" | "en" = settings.outputLanguage === "et" ? "et" : "en";
        const measurementPreference: MeasurementPreference =
          settings.measurementPreference ?? settings.measurementSystem ?? "metric";
        const activeAllergens = normalizeAllergenModes(msg.payload.allergenModes, msg.payload.glutenFree);

        // Back-compat: return the (maybe-translated) recipe result without downloading PDF.
        const extracted = msg.payload.extracted;
        const source_domain = getDomain(extracted.source_url);
        const parsed = parseAllIngredientLines(extracted.ingredients);
        const convertedSystem0 = parsed.map((p) => convertParsedIngredientToSystemLine(p, measurementPreference));
        const ingredients_in = convertedSystem0.map((x: any) => (x.metric_note_en ? `${x.metric_en} ${x.metric_note_en}` : x.metric_en));
        const steps_in = convertStepsTextForSystem(extracted.steps, measurementPreference);
        const allergenContext = formatAllergenContextForPrompt(buildAllergenContext(convertedSystem0, activeAllergens, steps_in));

        const srcLang: Lang = detectLanguageFromTexts([extracted.title, ...extracted.ingredients.slice(0, 30), ...extracted.steps.slice(0, 10)]);
        const translateNeeded =
          outputLanguage === "et"
            ? srcLang !== "et"
            : srcLang === "et";
        const taskType = determineAiTask({ translateNeeded, includeSubstitutions: msg.payload.includeSubstitutions, activeAllergens });
        const aiNeeded = shouldRunAi(taskType);
        const model = selectModelForTask(taskType, { qualityModel, economyModel, modelRouting }, activeAllergens);

        let outTitle = extracted.title;
        let outIngredients = ingredients_in;
        let outSteps = steps_in;
        let extraSubs: any[] | undefined;
        let warnings: string[] | undefined;
        if (aiNeeded) {
          ensureApiKey(apiKey);
          const translated = await translateToEtCached({
            taskType,
            model,
            apiKey,
            source_url: extracted.source_url,
            title_in: extracted.title,
            ingredients_in,
            steps_in,
            includeSubstitutions: msg.payload.includeSubstitutions,
            activeAllergens,
            measurementPreference,
            targetLanguage: outputLanguage,
            allergenContext,
          });
          outTitle = translated.result.title;
          outIngredients = translated.result.ingredients;
          outSteps = translated.result.steps;
          extraSubs = translated.result.extra_substitutions;
          warnings = translated.result.warnings;
          if (shouldRunValidationPass(taskType, activeAllergens, extraSubs?.length ?? 0)) {
            const validationModel = selectModelForTask("validation_only", { qualityModel, economyModel, modelRouting }, activeAllergens);
            const validationWarnings = await validateSubstitutionsCached({
              model: validationModel,
              apiKey,
              source_url: extracted.source_url,
              targetLanguage: outputLanguage,
              activeAllergens,
              substitutions: (extraSubs ?? []).map((s) => ({
                ingredient_en: s.ingredient_in,
                suggestions_et: s.suggestions_et,
                ...(s.note_et ? { note_et: s.note_et } : {}),
              })),
              relevantIngredients: ingredients_in,
              relevantSteps: steps_in,
            });
            warnings = [...(warnings ?? []), ...validationWarnings];
          }
        }
        const warnings_out = [...(warnings ?? [])];
        if (activeAllergens.length && warnings_out.length === 0) warnings_out.push(...fallbackWarnings(activeAllergens, outputLanguage));
        const subs =
          msg.payload.includeSubstitutions || activeAllergens.length
            ? mergeSubstitutions([], (extraSubs as any) ?? [])
            : [];
        const result: RecipeEtResult = {
          title_et: outTitle,
          source_url: extracted.source_url,
          source_domain,
          ...(extracted.servings ? { servings: extracted.servings } : {}),
          ...(extracted.times ? { times: extracted.times } : {}),
          ...(extracted.hero_image_url ? { hero_image_url: extracted.hero_image_url } : {}),
          ingredients: extracted.ingredients.map((orig, i) => ({ original: orig, et: outIngredients[i] ?? orig })),
          steps: extracted.steps.map((orig, i) => ({ original: orig, et: outSteps[i] ?? orig })),
          substitutions: subs,
          ...(warnings_out.length ? { warnings_et: warnings_out } : {}),
        };
        const resp: WorkerToPopupMessage = { type: "AI_PROCESS_RECIPE_RESULT", payload: { result } };
        sendResponse(resp);
        return;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await setJobStatus({ stage: "error", message: "Something went wrong.", error: message, finishedAt: Date.now() }).catch(() => {});
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


