import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";

type Settings = {
  openaiApiKey?: string;
  model?: string;
  defaultGlutenFree?: boolean;
  defaultIncludeSubstitutions?: boolean;
  outputLanguage?: "et" | "en";
  measurementSystem?: "metric" | "imperial";
};

const DEFAULT_MODEL = "gpt-5.4";
const DEFAULT_GLUTEN_FREE = true;
const DEFAULT_INCLUDE_SUBS = true;
const DEFAULT_OUTPUT_LANG: "et" | "en" = "et";
const DEFAULT_MEASUREMENT: "metric" | "imperial" = "metric";

const MODEL_OPTIONS = [
  { value: "gpt-5.4", label: "GPT-5.4 — parim kvaliteet, naturaalne tõlge", desc: "Soovitatud. Parim tõlkekvaliteet ja gluteenivaba kohandamine." },
  { value: "gpt-5.3", label: "GPT-5.3 — kiire ja kvaliteetne", desc: "Hea tasakaal kiiruse ja kvaliteedi vahel." },
  { value: "gpt-5.1", label: "GPT-5.1 — standard", desc: "Usaldusväärne ja ökonoomne valik." },
  { value: "gpt-4.1", label: "GPT-4.1 — ökonoomne", desc: "Kõige soodsam, piisav lihtsatele retseptidele." },
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
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [defaultGlutenFree, setDefaultGlutenFree] = useState(DEFAULT_GLUTEN_FREE);
  const [defaultIncludeSubs, setDefaultIncludeSubs] = useState(DEFAULT_INCLUDE_SUBS);
  const [outputLanguage, setOutputLanguage] = useState<"et" | "en">(DEFAULT_OUTPUT_LANG);
  const [measurementSystem, setMeasurementSystem] = useState<"metric" | "imperial">(DEFAULT_MEASUREMENT);
  const [status, setStatus] = useState<string | null>(null);
  const [loadedMask, setLoadedMask] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const stored = (await chrome.storage.sync.get([
        "openaiApiKey",
        "model",
        "defaultGlutenFree",
        "defaultIncludeSubstitutions",
        "outputLanguage",
        "measurementSystem",
      ])) as Settings;
      if (stored.model) setModel(stored.model);
      if (stored.openaiApiKey) {
        setLoadedMask(maskKey(stored.openaiApiKey));
      }
      if (typeof stored.defaultGlutenFree === "boolean") setDefaultGlutenFree(stored.defaultGlutenFree);
      if (typeof stored.defaultIncludeSubstitutions === "boolean") setDefaultIncludeSubs(stored.defaultIncludeSubstitutions);
      if (stored.outputLanguage === "et" || stored.outputLanguage === "en") setOutputLanguage(stored.outputLanguage);
      if (stored.measurementSystem === "metric" || stored.measurementSystem === "imperial")
        setMeasurementSystem(stored.measurementSystem);
    })();
  }, []);

  async function onSave() {
    setStatus(null);
    const toSave: Settings = {
      model: model.trim() || DEFAULT_MODEL,
      defaultGlutenFree,
      defaultIncludeSubstitutions: defaultIncludeSubs,
      outputLanguage,
      measurementSystem,
    };
    const trimmed = apiKey.trim();
    if (trimmed) toSave.openaiApiKey = trimmed;
    await chrome.storage.sync.set(toSave);
    setApiKey("");
    setLoadedMask(toSave.openaiApiKey ? maskKey(toSave.openaiApiKey) : loadedMask);
    setStatus("Salvestatud.");
  }

  async function onClearKey() {
    await chrome.storage.sync.remove(["openaiApiKey"]);
    setApiKey("");
    setLoadedMask(null);
    setStatus("API võti eemaldatud.");
  }

  const selectedModelDesc = MODEL_OPTIONS.find((o) => o.value === model)?.desc;

  return (
    <div className="app" style={{ width: 560, padding: 24 }}>
      <h1 className="title" style={{ fontSize: 18, marginBottom: 16 }}>CookbookLM — Seaded</h1>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="privacy-notice">
          <strong>Privaatsus</strong>
          API võti salvestatakse ainult sinu seadmesse. Retsepti sisu saadetakse ainult OpenAI-le tõlkimiseks. Me ei kasuta backend-serverit.
        </div>

        <div className="field">
          <div className="label">OpenAI API võti</div>
          <input
            className="input"
            type="password"
            placeholder={loadedMask ? `Salvestatud: ${loadedMask}` : "sk-…"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button className="btn" style={{ flex: 1 }} onClick={onSave}>
              Salvesta seaded
            </button>
            <button className="btn secondary" style={{ flex: 0, whiteSpace: "nowrap" }} onClick={onClearKey}>
              Eemalda võti
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="field" style={{ marginTop: 0 }}>
          <div className="label">AI mudel</div>
          <select
            className="input"
            value={MODEL_OPTIONS.some((o) => o.value === model) ? model : "__custom"}
            onChange={(e) => {
              if (e.target.value !== "__custom") setModel(e.target.value);
            }}
          >
            {MODEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
            {!MODEL_OPTIONS.some((o) => o.value === model) && (
              <option value="__custom">{model} (kohandatud)</option>
            )}
          </select>
          {selectedModelDesc && (
            <div className="muted small">{selectedModelDesc}</div>
          )}
          <div className="muted small" style={{ marginTop: 2 }}>
            Kohandatud mudeli nimi: <input
              className="input"
              style={{ width: 160, display: "inline-block", padding: "4px 6px", fontSize: 12, marginLeft: 4 }}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-5.4"
            />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 10 }}>Vaikimisi valikud</div>

        <div className="toggleRow" style={{ paddingTop: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Toggle checked={defaultGlutenFree} onChange={setDefaultGlutenFree} />
            <div>
              <span style={{ fontWeight: 500 }}>Gluteenivaba</span>
              <div className="muted small">AI kohandab retsepti ja lisab hoiatused</div>
            </div>
          </div>
        </div>

        <div className="toggleRow">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Toggle checked={defaultIncludeSubs} onChange={setDefaultIncludeSubs} />
            <div>
              <span style={{ fontWeight: 500 }}>Lisa asendused</span>
              <div className="muted small">Sisaldab koostisosade alternatiive PDF-is</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="label" style={{ marginBottom: 10 }}>Väljund</div>

        <div className="field" style={{ marginTop: 0 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 130, fontWeight: 500, fontSize: 13 }}>Keel</span>
            <select
              className="input"
              style={{ flex: 1 }}
              value={outputLanguage}
              onChange={(e) => setOutputLanguage(e.target.value as "et" | "en")}
            >
              <option value="et">Eesti keel</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>

        <div className="field">
          <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 130, fontWeight: 500, fontSize: 13 }}>Mõõtühikud</span>
            <select
              className="input"
              style={{ flex: 1 }}
              value={measurementSystem}
              onChange={(e) => setMeasurementSystem(e.target.value as "metric" | "imperial")}
            >
              <option value="metric">Meetriline (g / ml / °C)</option>
              <option value="imperial">Imperial (oz / cup / °F)</option>
            </select>
          </label>
        </div>

        <div className="muted small" style={{ marginTop: 8 }}>
          Teisendus toimub ainult siis, kui retseptis on vale süsteem (nt °F→°C).
        </div>
      </div>

      {status ? <div className="success" style={{ marginTop: 12 }}>{status}</div> : null}

      <div className="muted small" style={{ marginTop: 12, textAlign: "center" }}>
        API võtme saamiseks: <a href="https://platform.openai.com/api-keys" className="link" target="_blank" rel="noopener">platform.openai.com</a>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
