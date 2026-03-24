import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import type { ExtractedRecipe, JobStatusState, WorkerToPopupMessage } from "../shared_types";

type Stage = "idle" | "extracting" | "ai_processing" | "generating_pdf" | "done" | "error";

type PopupError =
  | { message: string; action?: "OPEN_OPTIONS" | "NONE" }
  | null;

const MODEL_OPTIONS = [
  { value: "gpt-5.4", label: "GPT-5.4 (parim)" },
  { value: "gpt-5.3", label: "GPT-5.3 (kiire)" },
  { value: "gpt-5.1", label: "GPT-5.1 (standard)" },
  { value: "gpt-4.1", label: "GPT-4.1 (ökonoomne)" },
];

function getFriendlyError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("Aktiivset vahelehte ei leitud.");
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
    throw new Error(resp?.error || "Retsepti ekstraktimine ebaõnnestus.");
  }
  return resp.extracted as ExtractedRecipe;
}

async function workerStartJob(extracted: ExtractedRecipe, includeSubstitutions: boolean, glutenFree: boolean, model?: string) {
  const resp = (await chrome.runtime.sendMessage({
    type: "START_GENERATE_PDF_JOB",
    payload: { extracted, includeSubstitutions, glutenFree, model },
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
const DEFAULT_GLUTEN_FREE = true;
const DEFAULT_INCLUDE_SUBS = true;

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

const stageText: Record<Stage, string> = {
  idle: "Valmis",
  extracting: "Otsin retsepti…",
  ai_processing: "Töötan…",
  generating_pdf: "Genereerin PDF…",
  done: "PDF allalaetud",
  error: "Viga",
};

function App() {
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<PopupError>(null);
  const [includeSubs, setIncludeSubs] = useState(DEFAULT_INCLUDE_SUBS);
  const [glutenFree, setGlutenFree] = useState(DEFAULT_GLUTEN_FREE);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [extracted, setExtracted] = useState<ExtractedRecipe | null>(null);
  const [job, setJob] = useState<JobStatusState | null>(null);

  const detectedTitle = extracted?.title || "—";

  const busy = useMemo(() => stage === "extracting" || stage === "ai_processing" || stage === "generating_pdf", [stage]);

  React.useEffect(() => {
    (async () => {
      const stored = (await chrome.storage.sync.get([
        "defaultGlutenFree",
        "defaultIncludeSubstitutions",
        "model",
      ])) as any;
      if (typeof stored.defaultGlutenFree === "boolean") setGlutenFree(stored.defaultGlutenFree);
      if (typeof stored.defaultIncludeSubstitutions === "boolean") setIncludeSubs(stored.defaultIncludeSubstitutions);
      if (stored.model) setModel(stored.model);
    })();

    (async () => {
      const s = await workerGetJobStatus();
      if (s) {
        setJob(s);
        if (s.stage === "ai_processing" || s.stage === "generating_pdf" || s.stage === "downloading") setStage("ai_processing");
        if (s.stage === "done") setStage("done");
        if (s.stage === "error") setStage("error");
      }
    })();

    const handler = (msg: WorkerToPopupMessage) => {
      if (msg?.type === "JOB_STATUS") {
        setJob(msg.payload.status);
        const st = msg.payload.status.stage;
        if (st === "ai_processing" || st === "generating_pdf" || st === "downloading") setStage("ai_processing");
        else if (st === "done") setStage("done");
        else if (st === "error") setStage("error");
        else setStage("idle");
      }
    };
    chrome.runtime.onMessage.addListener(handler as any);
    return () => chrome.runtime.onMessage.removeListener(handler as any);
  }, []);

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
          msg.includes("API") || msg.includes("võti")
            ? msg
            : `${msg}\n\nProovi teist retseptilehte või ava Seaded ja kontrolli API võtit.`,
        action: msg.toLowerCase().includes("api") ? "OPEN_OPTIONS" : "NONE",
      });
    }
  }

  async function onGenerateClick() {
    setError(null);
    setStage("ai_processing");
    try {
      const data = extracted ?? (await extractRecipeFromTab());
      setExtracted(data);
      await workerStartJob(data, includeSubs, glutenFree, model);
    } catch (e) {
      const msg = getFriendlyError(e);
      setStage("error");
      setError({
        message: msg,
        action: msg.toLowerCase().includes("api") ? "OPEN_OPTIONS" : "NONE",
      });
    }
  }

  async function onOpenOptions() {
    await chrome.runtime.openOptionsPage();
  }

  function onClosePopup() {
    window.close();
  }

  return (
    <div className="app">
      <div className="row" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h1 className="title" style={{ margin: 0 }}>CookbookLM</h1>
          <StatusBadge stage={stage} message={job?.message} />
        </div>
        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <a className="link small" href="#" onClick={onOpenOptions}>
            Seaded
          </a>
          <button className="btn secondary" style={{ width: "auto", padding: "4px 8px", fontSize: 12 }} onClick={onClosePopup}>
            ✕
          </button>
        </div>
      </div>

      <div className="card">
        <div style={{ marginBottom: 10 }}>
          <div className="label">Tuvastatud retsept</div>
          <div style={{ fontWeight: 600, fontSize: 14, marginTop: 2 }}>{detectedTitle}</div>
        </div>

        {error ? (
          <div className="error" style={{ whiteSpace: "pre-wrap", marginBottom: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Viga</div>
            {error.message}
            {error.action === "OPEN_OPTIONS" ? (
              <div style={{ marginTop: 8 }}>
                <button className="btn secondary" style={{ width: "auto" }} onClick={onOpenOptions}>
                  Ava Seaded
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {job?.stage === "downloading" ? <div className="success" style={{ marginBottom: 10 }}>Laen alla… Vaata Chrome allalaadimisi.</div> : null}
        {stage === "done" ? <div className="success" style={{ marginBottom: 10 }}>Valmis! Kontrolli allalaadimisi.</div> : null}

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button className="btn secondary" onClick={onExtractClick} disabled={busy}>
            {stage === "extracting" ? <span className="spinner" style={{ display: "inline-block" }} /> : "Tuvasta retsept"}
          </button>
          <button className="btn" onClick={onGenerateClick} disabled={busy}>
            {busy && stage !== "extracting" ? <span className="spinner" style={{ display: "inline-block", borderTopColor: "#fff", borderColor: "rgba(255,255,255,0.3)" }} /> : "Genereeri PDF"}
          </button>
        </div>

        <div className="hr" />

        <div className="toggleRow">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Toggle checked={includeSubs} onChange={setIncludeSubs} disabled={busy} />
            <span style={{ fontWeight: 500 }}>Lisa asendused</span>
          </div>
        </div>

        <div className="toggleRow">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Toggle checked={glutenFree} onChange={setGlutenFree} disabled={busy} />
            <span style={{ fontWeight: 500 }}>Gluteenivaba</span>
          </div>
          <span className="muted small">AI kohandab retsepti</span>
        </div>

        <div className="field">
          <div className="label">Mudel</div>
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
              <option value="__custom">{model} (kohandatud)</option>
            )}
          </select>
        </div>
      </div>

      <div className="muted small" style={{ marginTop: 10, lineHeight: 1.4 }}>
        Nipp: Kui retsept pole tuvastatav, proovi "Print recipe" vaadet.
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
