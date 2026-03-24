import type { RecipeEtResult } from "../shared_types";
import { renderRecipePdfArrayBuffer } from "../pdf_renderer";

type OffscreenMsg =
  | {
      type: "OFFSCREEN_RENDER_PDF";
      payload: { result: RecipeEtResult; heroImageDataUrl?: string };
    }
  | {
      type: "OFFSCREEN_RENDER_PDF_DATAURL";
      payload: { result: RecipeEtResult; heroImageDataUrl?: string };
    }
  | { type: string; payload?: any };

chrome.runtime.onMessage.addListener((msg: OffscreenMsg, _sender, sendResponse) => {
  if (!msg || msg.type !== "OFFSCREEN_RENDER_PDF") return;

  (async () => {
    try {
      const ab = await renderRecipePdfArrayBuffer(msg.payload.result, msg.payload.heroImageDataUrl);
      sendResponse({ ok: true, arrayBuffer: ab });
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  })();

  return true;
});

chrome.runtime.onMessage.addListener((msg: OffscreenMsg, _sender, sendResponse) => {
  if (!msg || msg.type !== "OFFSCREEN_RENDER_PDF_DATAURL") return;

  (async () => {
    try {
      const ab = await renderRecipePdfArrayBuffer(msg.payload.result, msg.payload.heroImageDataUrl);
      const blob = new Blob([ab], { type: "application/pdf" });
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("PDF base64 kodeerimine ebaõnnestus."));
        reader.readAsDataURL(blob);
      });
      sendResponse({ ok: true, dataUrl });
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  })();

  return true;
});


