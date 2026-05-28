import React, { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import type { AllergenId, ExtractedRecipe, JobStatusState, WorkerToPopupMessage } from "../shared_types";

type Stage = "idle" | "extracting" | "ai_processing" | "generating_pdf" | "done" | "error";

type PopupError =
  | { message: string; action?: "OPEN_OPTIONS" | "NONE" }
  | null;

const MODEL_OPTIONS = [
  { value: "gpt-5.4", label: "GPT-5.4 (best)" },
  { value: "gpt-5.3", label: "GPT-5.3 (fast)" },
  { value: "gpt-5.1", label: "GPT-5.1 (standard)" },
  { value: "gpt-4.1", label: "GPT-4.1 (economy)" },
];

const ALLERGEN_OPTIONS: Array<{ id: AllergenId; label: string }> = [
  { id: "gluten", label: "Gluten / celiac" },
  { id: "dairy", label: "Dairy" },
  { id: "egg", label: "Egg" },
  { id: "peanut", label: "Peanut" },
  { id: "treeNut", label: "Tree nuts" },
  { id: "soy", label: "Soy" },
  { id: "fish", label: "Fish" },
  { id: "shellfish", label: "Shellfish" },
  { id: "sesame", label: "Sesame" },
];

function getFriendlyError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("Could not find the active tab.");
  return tab;
}

async function injectContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content_script.js"],
  });
}

async function extractRecipeFromTab(): Promise<ExtractedRecipe> {
  const tab = await getActiveTab();
  await injectContentScript(tab.id!);
  const resp = await chrome.tabs.sendMessage(tab.id!, { type: "EXTRACT_RECIPE" });
  if (!resp?.ok) {
    throw new Error(resp?.error || "Recipe extraction failed.");
  }
  return resp.extracted as ExtractedRecipe;
}

async function workerStartJob(extracted: ExtractedRecipe, includeSubstitutions: boolean, allergenModes: AllergenId[], model?: string) {
  const resp = (await chrome.runtime.sendMessage({
    type: "START_GENERATE_PDF_JOB",
    payload: { extracted, includeSubstitutions, allergenModes, glutenFree: allergenModes.includes("gluten"), model },
  })) as WorkerToPopupMessage;
  if (resp?.type === "AI_PROCESS_RECIPE_ERROR") throw new Error(resp.payload.message);
  return resp;
}

async function workerGetJobStatus(): Promise<JobStatusState | null> {
  const resp = (await chrome.runtime.sendMessage({ type: "GET_JOB_STATUS" })) as WorkerToPopupMessage;
  if (resp?.type !== "JOB_STATUS") return null;
  return resp.payload.status;
}

const DEFAULT_MODEL = "gpt-5.4";
const DEFAULT_ALLERGEN_MODES: AllergenId[] = ["gluten"];
const DEFAULT_INCLUDE_SUBS = true;

const stageText: Record<Stage, string> = {
  idle: "Ready",
  extracting: "Detecting recipe...",
  ai_processing: "AI is processing...",
  generating_pdf: "Formatting PDF...",
  done: "PDF downloaded",
  error: "Error",
};

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="slider" />
    </label>
  );
}

function StatusBadge({ stage, message }: { stage: Stage; message?: string }) {
  const isProcessing = stage === "extracting" || stage === "ai_processing" || stage === "generating_pdf";
  const cls = isProcessing ? "processing" : stage === "done" ? "done" : stage === "error" ? "error" : "";

  return (
    <span className={`status-badge ${cls}`}>
      {isProcessing && <span className="pulse-dot" />}
      {message || stageText[stage]}
    </span>
  );
}

function ElapsedTimer({ startedAt }: { startedAt?: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt) return;
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  if (!startedAt) return null;
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return <span className="elapsed-time">{m > 0 ? `${m}m ${s}s` : `${s}s`}</span>;
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M6.9 1.7h2.2l.3 1.5a4.8 4.8 0 011.2.7l1.4-.5.9 1.6-1.1 1a5 5 0 010 1.4l1.1 1-.9 1.5-1.4-.5a5 5 0 01-1.2.7l-.3 1.6H6.9l-.3-1.6a5 5 0 01-1.2-.7l-1.4.5-.9-1.5 1.1-1a5 5 0 010-1.4l-1.1-1 .9-1.6 1.4.5a5 5 0 011.2-.7l.3-1.5z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M2 2l10 10M12 2L2 12" />
    </svg>
  );
}

function RecipeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="2" width="14" height="16" rx="2" />
      <path d="M7 6h6M7 10h6M7 14h3" />
    </svg>
  );
}

function App() {
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<PopupError>(null);
  const [includeSubs, setIncludeSubs] = useState(DEFAULT_INCLUDE_SUBS);
  const [allergenModes, setAllergenModes] = useState<AllergenId[]>(DEFAULT_ALLERGEN_MODES);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [extracted, setExtracted] = useState<ExtractedRecipe | null>(null);
  const [job, setJob] = useState<JobStatusState | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const headerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const detectedTitle = extracted?.title || job?.recipeTitle || null;
  const busy = useMemo(() => stage === "extracting" || stage === "ai_processing" || stage === "generating_pdf", [stage]);

  const handleScrollShadow = useCallback(() => {
    if (!headerRef.current || !sentinelRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) headerRef.current?.classList.toggle("scrolled", !entry.isIntersecting);
      },
      { threshold: 1 }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const cleanup = handleScrollShadow();
    return cleanup;
  }, [handleScrollShadow]);

  useEffect(() => {
    (async () => {
      const stored = (await chrome.storage.sync.get([
        "defaultGlutenFree",
        "defaultAllergenModes",
        "defaultIncludeSubstitutions",
        "model",
      ])) as any;
      if (Array.isArray(stored.defaultAllergenModes)) setAllergenModes(stored.defaultAllergenModes);
      else if (typeof stored.defaultGlutenFree === "boolean") setAllergenModes(stored.defaultGlutenFree ? ["gluten"] : []);
      if (typeof stored.defaultIncludeSubstitutions === "boolean") setIncludeSubs(stored.defaultIncludeSubstitutions);
      if (stored.model) setModel(stored.model);
    })();

    (async () => {
      const s = await workerGetJobStatus();
      if (s) {
        setJob(s);
        if (s.stage === "ai_processing" || s.stage === "generating_pdf" || s.stage === "downloading") setStage("ai_processing");
        if (s.stage === "done") {
          setStage("done");
          setShowSuccess(true);
        }
        if (s.stage === "error") setStage("error");
      }
    })();

    const handler = (msg: WorkerToPopupMessage) => {
      if (msg?.type === "JOB_STATUS") {
        setJob(msg.payload.status);
        const st = msg.payload.status.stage;
        if (st === "ai_processing" || st === "generating_pdf" || st === "downloading") setStage("ai_processing");
        else if (st === "done") {
          setStage("done");
          setShowSuccess(true);
        } else if (st === "error") setStage("error");
        else setStage("idle");
      }
    };
    chrome.runtime.onMessage.addListener(handler as any);
    return () => chrome.runtime.onMessage.removeListener(handler as any);
  }, []);

  useEffect(() => {
    if (showSuccess) {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setShowSuccess(false), 10000);
    }
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, [showSuccess]);

  async function onExtractClick() {
    setError(null);
    setStage("extracting");
    try {
      const data = await extractRecipeFromTab();
      setExtracted(data);
      setStage("idle");
    } catch (e) {
      const msg = getFriendlyError(e);
      setStage("error");
      setError({
        message:
          msg.toLowerCase().includes("api")
            ? msg
            : `${msg}\n\nTry another recipe page or open Settings to check your API key.`,
        action: msg.toLowerCase().includes("api") ? "OPEN_OPTIONS" : "NONE",
      });
    }
  }

  async function onGenerateClick() {
    setError(null);
    setShowSuccess(false);
    setStage("ai_processing");
    try {
      const data = extracted ?? (await extractRecipeFromTab());
      setExtracted(data);
      await workerStartJob(data, includeSubs, allergenModes, model);
    } catch (e) {
      const msg = getFriendlyError(e);
      setStage("error");
      setError({
        message: msg,
        action: msg.toLowerCase().includes("api") ? "OPEN_OPTIONS" : "NONE",
      });
    }
  }

  function onOpenOptions() {
    chrome.runtime.openOptionsPage();
  }

  function toggleAllergen(id: AllergenId, enabled: boolean) {
    setAllergenModes((current) => enabled ? Array.from(new Set([...current, id])) : current.filter((x) => x !== id));
  }

  function onClose() {
    window.close();
  }

  return (
    <div className="app">
      <div ref={sentinelRef} className="scroll-sentinel" />

      <header ref={headerRef} className="panel-header">
        <div className="panel-header-left">
          <RecipeIcon />
          <span className="panel-title">CookbookLM</span>
        </div>
        <div className="panel-header-right">
          <button className="icon-btn" onClick={onOpenOptions} title="Settings" aria-label="Settings">
            <GearIcon />
          </button>
          <button className="icon-btn close" onClick={onClose} title="Close" aria-label="Close panel">
            <CloseIcon />
          </button>
        </div>
      </header>

      <div className="panel-body">
        {/* Recipe card */}
        <div className="recipe-card">
          <div className="recipe-card-header">
            <div className="label">Detected recipe</div>
            <StatusBadge stage={stage} {...(job?.message ? { message: job.message } : {})} />
          </div>
          <div className="recipe-title">{detectedTitle || "Open a recipe page and click Detect recipe"}</div>
        </div>

        {/* Progress section */}
        {busy && (
          <div className="progress-section">
            <div className="progress-spinner-row">
              <span className="spinner" />
              <strong>{stage === "extracting" ? "Reading the page" : stage === "generating_pdf" ? "Formatting printable PDF" : "Reasoning recipe adaptation"}</strong>
            </div>
            <div className="progress-bar">
              <div className="progress-bar-fill" />
            </div>
            <div className="progress-info">
              <span className="progress-message">{job?.message || stageText[stage]}</span>
              <ElapsedTimer {...(job?.startedAt ? { startedAt: job.startedAt } : {})} />
            </div>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="banner error-banner">
            <div className="banner-title">Error</div>
            <div className="banner-message">{error.message}</div>
            {error.action === "OPEN_OPTIONS" && (
              <button className="btn secondary banner-btn" onClick={onOpenOptions}>Open Settings</button>
            )}
          </div>
        )}

        {/* Success banner */}
        {showSuccess && stage === "done" && (
          <div className="banner success-banner">
            <div className="banner-title">Done!</div>
            <div className="banner-message">The PDF has been downloaded. Check Chrome downloads.</div>
          </div>
        )}

        {/* Action buttons */}
        <div className="action-buttons">
          <button className="btn secondary" onClick={onExtractClick} disabled={busy}>
            {stage === "extracting" ? <span className="spinner" /> : null}
            Detect recipe
          </button>
          <button className="btn" onClick={onGenerateClick} disabled={busy}>
            {busy && stage !== "extracting" ? <span className="spinner spinner-white" /> : null}
            Generate PDF
          </button>
        </div>

        {/* Collapsible options */}
        <details className="options-section" open>
          <summary>Options</summary>
          <div className="options-content">
            <div className="toggleRow">
              <div className="toggle-label-group">
                <Toggle checked={includeSubs} onChange={setIncludeSubs} disabled={busy} />
                <span className="toggle-text">Include substitutions</span>
              </div>
              <span className="muted small">AI notes</span>
            </div>

            <div className="field">
              <div className="label">Dietary restrictions</div>
              {ALLERGEN_OPTIONS.map((a) => (
                <label key={a.id} className="checkbox-row compact">
                  <input
                    type="checkbox"
                    checked={allergenModes.includes(a.id)}
                    onChange={(e) => toggleAllergen(a.id, e.target.checked)}
                    disabled={busy}
                  />
                  <span>{a.label}</span>
                </label>
              ))}
              <div className="muted small">Active restrictions force AI reasoning and safety notes.</div>
            </div>

            <div className="field">
              <div className="label">Model</div>
              <select
                className="input"
                value={MODEL_OPTIONS.some((o) => o.value === model) ? model : "__custom"}
                onChange={(e) => {
                  if (e.target.value !== "__custom") setModel(e.target.value);
                }}
                disabled={busy}
              >
                {MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
                {!MODEL_OPTIONS.some((o) => o.value === model) && (
                  <option value="__custom">{model} (custom)</option>
                )}
              </select>
            </div>
          </div>
        </details>
      </div>

      <footer className="panel-footer">
        <span className="muted small">Tip: if a recipe is not detected, try the site’s print recipe view.</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
