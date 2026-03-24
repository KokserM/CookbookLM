import { extractRecipeFromDocument } from "./recipe_extractor";
import type { ExtractedRecipe } from "./shared_types";

type ExtractResponse =
  | { ok: true; extracted: ExtractedRecipe }
  | { ok: false; error: string };

function ensureUrl(): string {
  try {
    return window.location.href;
  } catch {
    return "";
  }
}

chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  if (!msg || msg.type !== "EXTRACT_RECIPE") return;

  try {
    const extracted = extractRecipeFromDocument(document, ensureUrl());
    if (!extracted) {
      const resp: ExtractResponse = {
        ok: false,
        error:
          "Sellelt lehelt ei õnnestunud retsepti leida. Kui lehel on „Print recipe“ vaade, ava see ja proovi uuesti.",
      };
      sendResponse(resp);
      return;
    }

    const resp: ExtractResponse = { ok: true, extracted };
    sendResponse(resp);
  } catch (e) {
    const resp: ExtractResponse = { ok: false, error: e instanceof Error ? e.message : String(e) };
    sendResponse(resp);
  }
});


