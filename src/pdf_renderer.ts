import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import type { RecipeEtResult } from "./shared_types";

function slugify(s: string): string {
  return (s || "retsept")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function fmtDateTimeEt(d = new Date()): string {
  // Date-only (no time) for footer stability.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function detectDataUrlFormat(dataUrl: string): "JPEG" | "PNG" | null {
  if (dataUrl.startsWith("data:image/jpeg")) return "JPEG";
  if (dataUrl.startsWith("data:image/jpg")) return "JPEG";
  if (dataUrl.startsWith("data:image/png")) return "PNG";
  return null;
}

async function convertDataUrlToPngIfNeeded(dataUrl: string): Promise<string> {
  const fmt = detectDataUrlFormat(dataUrl);
  if (fmt) return dataUrl;

  // Try to convert (e.g. webp) to PNG via canvas.
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas context puudub.");
        ctx.drawImage(img, 0, 0);
        const png = canvas.toDataURL("image/png");
        resolve(png);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("Pildi konverteerimine ebaõnnestus."));
    img.src = dataUrl;
  });
}

async function getImageNaturalSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) reject(new Error("Pildi mõõtmeid ei õnnestunud tuvastada."));
      else resolve({ w, h });
    };
    img.onerror = () => reject(new Error("Pildi laadimine ebaõnnestus."));
    img.src = dataUrl;
  });
}

function canvasRoundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

async function cropImageToRoundedCoverPng(
  dataUrl: string,
  targetWpx: number,
  targetHpx: number,
  radiusPx: number,
): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Pildi laadimine ebaõnnestus."));
    el.src = dataUrl;
  });

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) throw new Error("Pildi mõõtmeid ei õnnestunud tuvastada.");

  const canvas = document.createElement("canvas");
  canvas.width = targetWpx;
  canvas.height = targetHpx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context puudub.");

  // Transparent background so no "gray square" shows behind rounded corners in PDF.
  ctx.clearRect(0, 0, targetWpx, targetHpx);

  // Rounded clip
  canvasRoundRectPath(ctx, 0, 0, targetWpx, targetHpx, radiusPx);
  ctx.clip();

  // Cover fit
  const scale = Math.max(targetWpx / iw, targetHpx / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (targetWpx - dw) / 2;
  const dy = (targetHpx - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);

  return canvas.toDataURL("image/png");
}

function buildMetaLine(r: RecipeEtResult): string | undefined {
  const parts: string[] = [];
  if (r.servings) parts.push(`Portsud: ${r.servings}`);
  const t = r.times;
  const timeParts: string[] = [];
  if (t?.prep) timeParts.push(`Ettevalm.: ${t.prep}`);
  if (t?.cook) timeParts.push(`Küpset.: ${t.cook}`);
  if (t?.total) timeParts.push(`Kokku: ${t.total}`);
  if (timeParts.length) parts.push(timeParts.join(" · "));
  return parts.length ? parts.join("  |  ") : undefined;
}

type FlowPos = { page: number; y: number };

const ACCENT = { r: 22, g: 101, b: 52 };
const ACCENT_LIGHT = { r: 220, g: 242, b: 228 };
const TEXT_PRIMARY = { r: 17, g: 24, b: 39 };
const TEXT_SECONDARY = { r: 75, g: 85, b: 99 };
const TEXT_MUTED = { r: 107, g: 114, b: 128 };
const BORDER_LIGHT = { r: 229, g: 231, b: 235 };

async function buildRecipePdfDoc(result: RecipeEtResult, heroImageDataUrl?: string): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 16;
  const marginTop = 16;
  const marginBottom = 14;
  const footerH = 22;
  const SAFE_PAD_X = 10;
  const SAFE_PAD_BOTTOM = 2;

  const footerY = pageH - marginBottom;
  const bodyBottomY = pageH - marginBottom - footerH;
  const bodyBottomYSafe = bodyBottomY - SAFE_PAD_BOTTOM;

  const title = result.title_et || "Retsept";
  const metaLine = buildMetaLine(result);

  const setColor = (c: { r: number; g: number; b: number }) => doc.setTextColor(c.r, c.g, c.b);
  const setFillC = (c: { r: number; g: number; b: number }) => doc.setFillColor(c.r, c.g, c.b);
  const setDrawC = (c: { r: number; g: number; b: number }) => doc.setDrawColor(c.r, c.g, c.b);

  const drawAccentBar = (x: number, y: number, w: number) => {
    setFillC(ACCENT);
    doc.rect(x, y, w, 0.8, "F");
  };

  const renderFirstPageHeader = async (): Promise<{ bodyStartY: number }> => {
    drawAccentBar(marginX, marginTop - 4, pageW - marginX * 2);

    setColor(TEXT_PRIMARY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    const titleLines = doc.splitTextToSize(title, pageW - marginX * 2);
    doc.text(titleLines, marginX, marginTop + 2);

    let y = marginTop + 2 + titleLines.length * 8;
    if (metaLine) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      setColor(TEXT_SECONDARY);
      doc.text(doc.splitTextToSize(metaLine, pageW - marginX * 2), marginX, y);
      y += 6;
    }

    drawAccentBar(marginX, y, 40);
    y += 4;

    if (result.warnings_et && result.warnings_et.length) {
      const fullW = pageW - marginX * 2;
      const headerText = "⚠ Gluteenivaba hoiatus";
      const bullets = result.warnings_et.map((w) => `  •  ${w}`);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      const headerLines = doc.splitTextToSize(headerText, fullW - 10);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      const bodyLines = bullets.flatMap((b) => doc.splitTextToSize(b, fullW - 12));
      const lineH = 4.2;
      const boxH = Math.min(50, (headerLines.length + bodyLines.length) * lineH + 10);
      setFillC({ r: 254, g: 249, b: 195 });
      setDrawC({ r: 234, g: 179, b: 8 });
      doc.setLineWidth(0.4);
      doc.roundedRect(marginX, y + 1, fullW, boxH, 3, 3, "FD");

      doc.setFont("helvetica", "bold");
      doc.setTextColor(120, 53, 15);
      doc.text(headerLines, marginX + 5, y + 6);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.2);
      doc.text(bodyLines.slice(0, Math.floor((boxH - 12) / lineH)), marginX + 5, y + 6 + headerLines.length * lineH + 1);
      y += boxH + 5;

      setColor(TEXT_PRIMARY);
      doc.setLineWidth(0.2);
    }
    return { bodyStartY: y + 4 };
  };

  const renderSmallHeader = () => {
    drawAccentBar(marginX, 8, 30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    setColor(TEXT_MUTED);
    doc.text(title.length > 50 ? title.slice(0, 48) + "…" : title, marginX, 14);
    setColor(TEXT_PRIMARY);
  };

  const ensurePage = (page: number) => {
    while (doc.getNumberOfPages() < page) {
      doc.addPage();
      doc.setPage(doc.getNumberOfPages());
      renderSmallHeader();
    }
  };

  // Utility: ensure we have enough vertical space left on the current page, otherwise advance to next page.
  // Used for full-width sections like substitutions.
  const ensureSpace = (pos: FlowPos, needed: number, startYOnNewPage: number): FlowPos => {
    if (pos.y + needed <= bodyBottomYSafe) return pos;
    const nextPage = pos.page + 1;
    ensurePage(nextPage);
    doc.setPage(nextPage);
    renderSmallHeader();
    return { page: nextPage, y: startYOnNewPage };
  };

  const sectionTitle = (x: number, y: number, text: string) => {
    setColor(ACCENT);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(text.toUpperCase(), x, y);
    drawAccentBar(x, y + 1.5, Math.min(doc.getTextWidth(text.toUpperCase()) + 2, 60));
    setColor(TEXT_PRIMARY);
  };

  // --- Recipe card layout (requested) ---
  const colGap = 10;
  const colW = (pageW - marginX * 2 - colGap) / 2;
  const leftX = marginX;
  const rightX = marginX + colW + colGap;
  const radius = 5;

  const ingBox = 3.2;
  const ingLineGap = 4.8;
  const stepLineGap = 4.9;

  const renderHeroInBox = async (x: number, y: number, wBox: number, hBox: number) => {
    if (!heroImageDataUrl) return;
    try {
      const safeDataUrl = await convertDataUrlToPngIfNeeded(heroImageDataUrl);
      // Avoid jsPDF clipping (can make later text "invisible" in some viewers). Pre-crop on canvas instead.
      const PX_PER_MM = 6; // good quality without huge memory
      const croppedPng = await cropImageToRoundedCoverPng(
        safeDataUrl,
        Math.max(1, Math.round(wBox * PX_PER_MM)),
        Math.max(1, Math.round(hBox * PX_PER_MM)),
        Math.max(0, Math.round(radius * PX_PER_MM)),
      );
      doc.addImage(croppedPng, "PNG", x, y, wBox, hBox, undefined, "FAST");

      doc.setDrawColor(229, 231, 235);
      doc.roundedRect(x, y, wBox, hBox, radius, radius, "S");
    } catch {
      // omit image gracefully
    }
  };

  const renderIngredientsColumn = (
    page: number,
    startIndex: number,
    x: number,
    yStart: number,
    colWidth: number,
    yMax: number,
    titleText: string,
  ): { nextIndex: number; endY: number } => {
    doc.setPage(page);
    sectionTitle(x, yStart, titleText);
    let y = yStart + 9;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    setColor(TEXT_PRIMARY);

    const maxW = colWidth - ingBox - 4;

    let idx = startIndex;
    for (; idx < result.ingredients.length; idx++) {
      const ing = result.ingredients[idx];
      const line = ing.et || ing.original;
      const wrapped = doc.splitTextToSize(line, maxW);
      const noteLines = ing.metric_notes ? doc.splitTextToSize(ing.metric_notes, maxW) : [];
      const needH = wrapped.length * ingLineGap + (noteLines.length ? noteLines.length * ingLineGap : 0) + 2.4;
      if (y + needH > yMax) break;

      setFillC(ACCENT);
      doc.circle(x + ingBox / 2, y - ingBox / 2 + 0.6, 1.2, "F");
      setColor(TEXT_PRIMARY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      doc.text(wrapped, x + ingBox + 3, y);
      y += wrapped.length * ingLineGap;

      if (noteLines.length) {
        doc.setFontSize(9);
        setColor(TEXT_SECONDARY);
        doc.setFont("helvetica", "italic");
        doc.text(noteLines, x + ingBox + 3, y);
        y += noteLines.length * ingLineGap;
        doc.setFontSize(10.5);
        doc.setFont("helvetica", "normal");
        setColor(TEXT_PRIMARY);
      }

      y += 2.4;
    }

    return { nextIndex: idx, endY: y };
  };

  const renderStepsFullWidth = (start: FlowPos, startYOnNewPage: number, titleText: string): FlowPos => {
    let pos = start;
    doc.setPage(pos.page);
    sectionTitle(marginX, pos.y, titleText);
    pos.y += 9;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    setColor(TEXT_PRIMARY);

    const numW = 9;
    const maxW = pageW - marginX * 2 - numW - SAFE_PAD_X;

    for (let i = 0; i < result.steps.length; i++) {
      const st = result.steps[i];
      const text = st.et || st.original;
      const wrapped = doc.splitTextToSize(text, maxW);
      const needH = wrapped.length * stepLineGap + 3.5;
      pos = ensureSpace(pos, needH, startYOnNewPage);
      doc.setPage(pos.page);

      setFillC(ACCENT);
      doc.circle(marginX + 3, pos.y - 1.2, 3.2, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(255, 255, 255);
      const numStr = String(i + 1);
      const numTw = doc.getTextWidth(numStr);
      doc.text(numStr, marginX + 3 - numTw / 2, pos.y);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      setColor(TEXT_PRIMARY);
      doc.text(wrapped, marginX + numW, pos.y);
      pos.y += wrapped.length * stepLineGap + 3.5;
    }
    return pos;
  };

  const renderSubstitutions = (start: FlowPos, startYOnNewPage: number): FlowPos => {
    if (!result.substitutions?.length) return start;
    let pos = start;

    pos.y += 4;
    const titleH = 9;
    pos = ensureSpace(pos, titleH, startYOnNewPage);
    doc.setPage(pos.page);

    setDrawC(BORDER_LIGHT);
    doc.line(marginX, pos.y - 3, pageW - marginX, pos.y - 3);

    sectionTitle(marginX, pos.y, "Asendused");
    pos.y += 9;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    setColor(TEXT_PRIMARY);

    const lineGap = 4.8;
    const fullW = pageW - marginX * 2;
    for (const s of result.substitutions) {
      const sugg = (s.suggestions_et || []).join("  ·  ");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      const headWrapped = s.ingredient ? doc.splitTextToSize(`→ ${s.ingredient}`, fullW) : [];
      doc.setFont("helvetica", "normal");
      const suggWrapped = doc.splitTextToSize(`   ${sugg}`, fullW);
      const noteWrapped = s.note_et ? doc.splitTextToSize(`   ${s.note_et}`, fullW) : [];
      const blockH = headWrapped.length * lineGap + suggWrapped.length * lineGap + noteWrapped.length * lineGap + 2;
      pos = ensureSpace(pos, blockH, startYOnNewPage);
      doc.setPage(pos.page);

      if (headWrapped.length) {
        setColor(ACCENT);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text(headWrapped, marginX, pos.y);
        pos.y += headWrapped.length * lineGap;
      }

      setColor(TEXT_PRIMARY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(suggWrapped, marginX, pos.y);
      pos.y += suggWrapped.length * lineGap;

      if (noteWrapped.length) {
        setColor(TEXT_SECONDARY);
        doc.setFont("helvetica", "italic");
        doc.setFontSize(9);
        doc.text(noteWrapped, marginX, pos.y);
        pos.y += noteWrapped.length * lineGap;
      }
      pos.y += 2;
    }
    setColor(TEXT_PRIMARY);
    doc.setFont("helvetica", "normal");
    return pos;
  };

  // 1) First page header (title/meta/image)
  const { bodyStartY } = await renderFirstPageHeader();
  const startYOnNewPage = 20; // after small header

  // 2) Ingredients-first layout:
  // - Page 1: ingredients left column flowing down the page; hero image top-right (fixed height).
  // - Ingredients may continue on subsequent pages (still before instructions).
  // - Instructions start ONLY after ingredients finish, and start below the taller of:
  //   (a) ingredients end Y on the last ingredients page, (b) image bottom Y on that page (page 1 only).

  const imgBoxW = colW;
  const imgBoxH = 78; // consistent, modern card proportion
  const imgBoxY1 = bodyStartY;
  const imgBoxBottomY1 = heroImageDataUrl ? imgBoxY1 + imgBoxH : bodyStartY;

  let page = 1;
  let ingIndex = 0;
  let lastIngredientsEndY = bodyStartY;

  // Page 1: ingredients in left column; image in right column
  {
    const yStart = bodyStartY;
    const yMax = bodyBottomYSafe;
    const ingRes = renderIngredientsColumn(1, ingIndex, leftX, yStart, colW, yMax, "Koostisosad");
    ingIndex = ingRes.nextIndex;
    lastIngredientsEndY = ingRes.endY;
    if (heroImageDataUrl) {
      await renderHeroInBox(rightX, imgBoxY1, imgBoxW, imgBoxH);
    }
  }

  // Continue ingredients on new pages until complete
  while (ingIndex < result.ingredients.length) {
    page++;
    ensurePage(page);
    doc.setPage(page);
    renderSmallHeader();
    const yStart = startYOnNewPage;
    const yMax = bodyBottomYSafe;
    const ingRes = renderIngredientsColumn(page, ingIndex, leftX, yStart, colW, yMax, "Koostisosad (jätkub)");
    ingIndex = ingRes.nextIndex;
    lastIngredientsEndY = ingRes.endY;
  }

  // Start steps after ingredients end, and after the image column if it was taller (page 1).
  let stepsStartY = lastIngredientsEndY + 6;
  if (page === 1) stepsStartY = Math.max(stepsStartY, imgBoxBottomY1 + 6);

  // If there isn't enough space to start steps on this page, move to a new page.
  if (stepsStartY > bodyBottomYSafe - 12) {
    page++;
    ensurePage(page);
    doc.setPage(page);
    renderSmallHeader();
    stepsStartY = startYOnNewPage;
  }

  let pos: FlowPos = { page, y: stepsStartY };
  pos = renderStepsFullWidth(pos, startYOnNewPage, "Valmistamine");
  const subsEnd = renderSubstitutions(pos, startYOnNewPage);
  doc.setPage(subsEnd.page);

  const totalPages = doc.getNumberOfPages();
  const ts = fmtDateTimeEt();
  const footerText = `${result.source_domain}  ·  ${ts}`;
  const qrSizeMm = 16;
  const qrPadMm = 3;
  const footerTextMaxW = pageW - marginX * 2 - qrSizeMm - qrPadMm - 30;
  const footerLines = doc.splitTextToSize(footerText, footerTextMaxW);
  let qrDataUrl: string | undefined;
  try {
    qrDataUrl = await QRCode.toDataURL(result.source_url, { errorCorrectionLevel: "M", margin: 1, width: 200 });
  } catch {
    qrDataUrl = undefined;
  }

  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);

    setDrawC(BORDER_LIGHT);
    doc.line(marginX, footerY - footerH + 2, pageW - marginX, footerY - footerH + 2);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setColor(TEXT_MUTED);
    const textY = footerY - 4;
    doc.text(footerLines, marginX, textY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const pageNumText = `${p} / ${totalPages}`;
    const pageNumW = doc.getTextWidth(pageNumText);
    doc.text(pageNumText, pageW - marginX - qrSizeMm - qrPadMm - pageNumW, textY);

    if (qrDataUrl) {
      const qrX = pageW - marginX - qrSizeMm;
      const qrY = pageH - marginBottom - qrSizeMm;
      doc.addImage(qrDataUrl, "PNG", qrX, qrY, qrSizeMm, qrSizeMm, undefined, "FAST");
    }
  }

  const filename = `retsept-${slugify(title)}.pdf`;
  // Caller decides how to save/download.
  void filename;
  return doc;
}

export async function renderRecipePdfArrayBuffer(result: RecipeEtResult, heroImageDataUrl?: string): Promise<ArrayBuffer> {
  const doc = await buildRecipePdfDoc(result, heroImageDataUrl);
  // jsPDF supports arraybuffer output for downloads via chrome.downloads.
  return doc.output("arraybuffer") as ArrayBuffer;
}

export async function generateRecipePdf(result: RecipeEtResult, heroImageDataUrl?: string): Promise<void> {
  const doc = await buildRecipePdfDoc(result, heroImageDataUrl);
  const filename = `retsept-${slugify(result.title_et || "retsept")}.pdf`;
  doc.save(filename);
}


