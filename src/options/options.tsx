import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import type { AllergenId, MeasurementPreference, ModelRoutingMode, OutputLanguage, PdfPageFormat } from "../shared_types";

type Settings = {
  model?: string;
  qualityModel?: string;
  economyModel?: string;
  modelRouting?: ModelRoutingMode;
  defaultGlutenFree?: boolean;
  defaultAllergenModes?: AllergenId[];
  defaultIncludeSubstitutions?: boolean;
  outputLanguage?: OutputLanguage;
  measurementSystem?: MeasurementPreference;
  measurementPreference?: MeasurementPreference;
  pdfPageFormat?: PdfPageFormat;
};

const DEFAULT_MODEL = "gpt-5.4";
const DEFAULT_ECONOMY_MODEL = "gpt-5.1";
const DEFAULT_ROUTING: ModelRoutingMode = "balanced";
const DEFAULT_GLUTEN_FREE = true;
const DEFAULT_INCLUDE_SUBS = true;
const DEFAULT_OUTPUT_LANG: OutputLanguage = "en";
const DEFAULT_MEASUREMENT: MeasurementPreference = "metric";
const DEFAULT_PAGE_FORMAT: PdfPageFormat = "a4";

const MODEL_OPTIONS = [
  { value: "gpt-5.4", label: "GPT-5.4 — best quality", desc: "Recommended for recipe adaptation and allergen reasoning." },
  { value: "gpt-5.3", label: "GPT-5.3 — fast quality", desc: "Good balance of speed and quality." },
  { value: "gpt-5.1", label: "GPT-5.1 — standard", desc: "Reliable general-purpose choice." },
  { value: "gpt-4.1", label: "GPT-4.1 — economical", desc: "Lower-cost option for simpler recipes." },
];

const ALLERGEN_OPTIONS: Array<{ id: AllergenId; label: string; desc: string }> = [
  { id: "gluten", label: "Gluten / celiac", desc: "Requires label and cross-contamination warnings." },
  { id: "dairy", label: "Dairy", desc: "Milk, cream, butter, cheese, yogurt." },
  { id: "egg", label: "Egg", desc: "Binding, leavening, coating, and emulsions." },
  { id: "peanut", label: "Peanut", desc: "Peanuts and peanut butter." },
  { id: "treeNut", label: "Tree nuts", desc: "Almonds, walnuts, cashews, hazelnuts, and similar." },
  { id: "soy", label: "Soy", desc: "Soy sauce, tofu, miso, soy milk, tamari." },
  { id: "fish", label: "Fish", desc: "Fish, anchovy, fish sauce." },
  { id: "shellfish", label: "Shellfish", desc: "Shrimp, crab, lobster, oyster sauce." },
  { id: "sesame", label: "Sesame", desc: "Sesame seeds, tahini, sesame oil." },
];

function maskKey(key: string): string {
  if (key.length <= 8) return "********";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="slider" />
    </label>
  );
}

function App() {
  const [apiKey, setApiKey] = useState("");
  const [qualityModel, setQualityModel] = useState(DEFAULT_MODEL);
  const [economyModel, setEconomyModel] = useState(DEFAULT_ECONOMY_MODEL);
  const [modelRouting, setModelRouting] = useState<ModelRoutingMode>(DEFAULT_ROUTING);
  const [defaultAllergenModes, setDefaultAllergenModes] = useState<AllergenId[]>(["gluten"]);
  const [defaultIncludeSubs, setDefaultIncludeSubs] = useState(DEFAULT_INCLUDE_SUBS);
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>(DEFAULT_OUTPUT_LANG);
  const [measurementPreference, setMeasurementPreference] = useState<MeasurementPreference>(DEFAULT_MEASUREMENT);
  const [pdfPageFormat, setPdfPageFormat] = useState<PdfPageFormat>(DEFAULT_PAGE_FORMAT);
  const [status, setStatus] = useState<string | null>(null);
  const [loadedMask, setLoadedMask] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const stored = (await chrome.storage.sync.get([
        "model",
        "qualityModel",
        "economyModel",
        "modelRouting",
        "defaultGlutenFree",
        "defaultAllergenModes",
        "defaultIncludeSubstitutions",
        "outputLanguage",
        "measurementSystem",
        "measurementPreference",
        "pdfPageFormat",
      ])) as Settings;
      const keyStored = (await chrome.storage.local.get(["openaiApiKey"])) as { openaiApiKey?: string };
      if (stored.qualityModel || stored.model) setQualityModel(stored.qualityModel ?? stored.model ?? DEFAULT_MODEL);
      if (stored.economyModel) setEconomyModel(stored.economyModel);
      if (stored.modelRouting === "balanced" || stored.modelRouting === "best_quality" || stored.modelRouting === "lowest_cost")
        setModelRouting(stored.modelRouting);
      if (keyStored.openaiApiKey) {
        setLoadedMask(maskKey(keyStored.openaiApiKey));
      }
      if (Array.isArray(stored.defaultAllergenModes)) setDefaultAllergenModes(stored.defaultAllergenModes);
      else if (typeof stored.defaultGlutenFree === "boolean") setDefaultAllergenModes(stored.defaultGlutenFree ? ["gluten"] : []);
      if (typeof stored.defaultIncludeSubstitutions === "boolean") setDefaultIncludeSubs(stored.defaultIncludeSubstitutions);
      if (stored.outputLanguage === "et" || stored.outputLanguage === "en") setOutputLanguage(stored.outputLanguage);
      const storedMeasurement = stored.measurementPreference ?? stored.measurementSystem;
      if (storedMeasurement === "metric" || storedMeasurement === "imperial" || storedMeasurement === "source" || storedMeasurement === "mixed")
        setMeasurementPreference(storedMeasurement);
      if (stored.pdfPageFormat === "a4" || stored.pdfPageFormat === "letter" || stored.pdfPageFormat === "legal" || stored.pdfPageFormat === "a5")
        setPdfPageFormat(stored.pdfPageFormat);
    })();
  }, []);

  async function onSave() {
    setStatus(null);
    const toSave: Settings = {
      model: qualityModel.trim() || DEFAULT_MODEL,
      qualityModel: qualityModel.trim() || DEFAULT_MODEL,
      economyModel: economyModel.trim() || DEFAULT_ECONOMY_MODEL,
      modelRouting,
      defaultGlutenFree: defaultAllergenModes.includes("gluten"),
      defaultAllergenModes,
      defaultIncludeSubstitutions: defaultIncludeSubs,
      outputLanguage,
      measurementSystem: measurementPreference,
      measurementPreference,
      pdfPageFormat,
    };
    const trimmed = apiKey.trim();
    await chrome.storage.sync.set(toSave);
    if (trimmed) await chrome.storage.local.set({ openaiApiKey: trimmed } as any);
    setApiKey("");
    setLoadedMask(trimmed ? maskKey(trimmed) : loadedMask);
    setStatus("Settings saved.");
  }

  async function onClearKey() {
    await chrome.storage.local.remove(["openaiApiKey"]);
    await chrome.storage.sync.remove(["openaiApiKey"]);
    setApiKey("");
    setLoadedMask(null);
    setStatus("API key removed.");
  }

  const selectedQualityDesc = MODEL_OPTIONS.find((o) => o.value === qualityModel)?.desc;
  const selectedEconomyDesc = MODEL_OPTIONS.find((o) => o.value === economyModel)?.desc;

  function toggleAllergen(id: AllergenId, enabled: boolean) {
    setDefaultAllergenModes((current) => enabled ? Array.from(new Set([...current, id])) : current.filter((x) => x !== id));
  }

  return (
    <div className="app" style={{ width: 560, padding: 24 }}>
      <h1 className="title" style={{ fontSize: 18, marginBottom: 16 }}>CookbookLM Settings</h1>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="privacy-notice">
          <strong>Privacy</strong>
          Your OpenAI API key is stored locally in this browser. Recipe title, ingredients, steps, and source URL are sent to OpenAI only when you process a recipe. CookbookLM does not use its own backend server.
        </div>

        <div className="field">
          <div className="label">OpenAI API key</div>
          <input
            className="input"
            type="password"
            placeholder={loadedMask ? `Saved: ${loadedMask}` : "sk-..."}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button className="btn" style={{ flex: 1 }} onClick={onSave}>
              Save settings
            </button>
            <button className="btn secondary" style={{ flex: 0, whiteSpace: "nowrap" }} onClick={onClearKey}>
              Remove key
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="field" style={{ marginTop: 0 }}>
          <div className="label">AI cost mode</div>
          <select
            className="input"
            value={modelRouting}
            onChange={(e) => setModelRouting(e.target.value as ModelRoutingMode)}
          >
            <option value="balanced">Balanced: economy for simple tasks, quality for allergen safety</option>
            <option value="best_quality">Best quality: use quality model for all AI tasks</option>
            <option value="lowest_cost">Lowest cost: use economy model except high-risk adaptation</option>
          </select>
        </div>

        <div className="field">
          <div className="label">Quality model</div>
          <select className="input" value={MODEL_OPTIONS.some((o) => o.value === qualityModel) ? qualityModel : "__custom"} onChange={(e) => {
            if (e.target.value !== "__custom") setQualityModel(e.target.value);
          }}>
            {MODEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            {!MODEL_OPTIONS.some((o) => o.value === qualityModel) && <option value="__custom">{qualityModel} (custom)</option>}
          </select>
          {selectedQualityDesc && <div className="muted small">{selectedQualityDesc}</div>}
          <input className="input" value={qualityModel} onChange={(e) => setQualityModel(e.target.value)} placeholder="gpt-5.4" />
        </div>

        <div className="field">
          <div className="label">Economy model</div>
          <select className="input" value={MODEL_OPTIONS.some((o) => o.value === economyModel) ? economyModel : "__custom"} onChange={(e) => {
            if (e.target.value !== "__custom") setEconomyModel(e.target.value);
          }}>
            {MODEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            {!MODEL_OPTIONS.some((o) => o.value === economyModel) && <option value="__custom">{economyModel} (custom)</option>}
          </select>
          {selectedEconomyDesc && <div className="muted small">{selectedEconomyDesc}</div>}
          <input className="input" value={economyModel} onChange={(e) => setEconomyModel(e.target.value)} placeholder="gpt-5.1" />
          <div className="muted small">Allergen and celiac adaptations may still use the quality model for safety.</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 10 }}>Default options</div>

        <div className="toggleRow" style={{ paddingTop: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Toggle checked={defaultIncludeSubs} onChange={setDefaultIncludeSubs} />
            <div>
              <span style={{ fontWeight: 500 }}>Include substitutions</span>
              <div className="muted small">Show ingredient alternatives and method notes in the PDF</div>
            </div>
          </div>
        </div>

        <div className="field">
          <div className="label">Dietary restrictions / allergens</div>
          {ALLERGEN_OPTIONS.map((a) => (
            <label key={a.id} className="checkbox-row">
              <input
                type="checkbox"
                checked={defaultAllergenModes.includes(a.id)}
                onChange={(e) => toggleAllergen(a.id, e.target.checked)}
              />
              <span>
                <strong>{a.label}</strong>
                <span className="muted small"> — {a.desc}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="label" style={{ marginBottom: 10 }}>Output</div>

        <div className="field" style={{ marginTop: 0 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 150, fontWeight: 500, fontSize: 13 }}>Recipe language</span>
            <select
              className="input"
              style={{ flex: 1 }}
              value={outputLanguage}
              onChange={(e) => setOutputLanguage(e.target.value as OutputLanguage)}
            >
              <option value="en">English</option>
              <option value="et">Estonian</option>
            </select>
          </label>
        </div>

        <div className="field">
          <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 150, fontWeight: 500, fontSize: 13 }}>Measurements</span>
            <select
              className="input"
              style={{ flex: 1 }}
              value={measurementPreference}
              onChange={(e) => setMeasurementPreference(e.target.value as MeasurementPreference)}
            >
              <option value="metric">Metric (g / ml / °C)</option>
              <option value="imperial">Imperial / US (cups / lb / oz / °F)</option>
              <option value="source">Keep original recipe units</option>
              <option value="mixed">Mixed household-friendly units</option>
            </select>
          </label>
        </div>

        <div className="field">
          <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 150, fontWeight: 500, fontSize: 13 }}>PDF page size</span>
            <select
              className="input"
              style={{ flex: 1 }}
              value={pdfPageFormat}
              onChange={(e) => setPdfPageFormat(e.target.value as PdfPageFormat)}
            >
              <option value="a4">A4</option>
              <option value="letter">US Letter</option>
              <option value="legal">US Legal</option>
              <option value="a5">A5</option>
            </select>
          </label>
        </div>

        <div className="muted small" style={{ marginTop: 8 }}>
          Measurement conversion follows this setting. Allergen substitutions are reasoned by the LLM from recipe context.
        </div>
      </div>

      {status ? <div className="success" style={{ marginTop: 12 }}>{status}</div> : null}

      <div className="muted small" style={{ marginTop: 12, textAlign: "center" }}>
        Get an API key at <a href="https://platform.openai.com/api-keys" className="link" target="_blank" rel="noopener">platform.openai.com</a>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
