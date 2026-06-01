# CookbookLM

A Chrome extension that extracts recipes from webpages, uses your own OpenAI API key to reason about substitutions and dietary restrictions, and generates print-ready recipe PDFs.

## Features

- **Recipe extraction** — Parses structured data (JSON-LD, microdata) and falls back to DOM heuristics, including Estonian article-style recipes
- **AI-powered adaptation** — Uses OpenAI with strict prompts for translation, substitution reasoning, and allergen-aware recipe guidance
- **Measurement preferences** — User-selectable metric, imperial/US, original-source, or mixed household-friendly units
- **Dietary restrictions** — Gluten/celiac, dairy, egg, nuts, soy, fish/shellfish, and sesame context detection with LLM-reasoned substitutions
- **PDF generation** — Print-ready layouts with selectable page sizes, substitutions, safety notes, QR code source link, and page numbers
- **Caching** — Translations are cached locally (SHA-256 keyed) to avoid repeated API calls
- **Language detection** — Skips translation when no translation/adaptation/substitution pass is needed

## Tech Stack

- **Chrome Manifest V3** extension (service worker, offscreen document, content script)
- **React 19** for popup and options UI
- **TypeScript 5.9** with strict mode
- **Vite 7** for building (multi-entry + content script IIFE)
- **jsPDF** for PDF generation
- **QRCode** for source URL QR codes in the PDF footer
- **Vitest** for unit tests

## Getting Started

### Prerequisites

- Node.js 18+
- An [OpenAI API key](https://platform.openai.com/api-keys) with access to GPT-5.4 (or GPT-5.3/5.1/4.1)

### Install & Build

```powershell
npm install
npm run build
```

### Load in Chrome

1. Navigate to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `dist/` folder
4. Click the extension icon and go to **Settings** to enter your own OpenAI API key

### Development

```powershell
npm run build       # Full production build
npm run typecheck   # TypeScript type checking
npm test            # Run unit tests (vitest)
```

After rebuilding, refresh the extension on `chrome://extensions/` to pick up changes.

## Usage

1. Navigate to any recipe page (e.g. AllRecipes, BBC Good Food, Nami-Nami, Toidutare)
2. Open CookbookLM from the Chrome side panel
3. Click **Detect recipe** to extract, or **Generate PDF** to extract + process + download in one step
4. Select dietary restrictions and whether to include substitutions
5. Choose recipe language, measurements, and PDF page size in Settings
6. The PDF downloads automatically to your Downloads folder

## Chrome Web Store Release

CookbookLM has been submitted to Chrome Web Store review. For future updates:

```powershell
npm test
npm run typecheck
npm run package
```

Upload the generated `cookbooklm-webstore.zip` in the Chrome Web Store Developer Dashboard. The ZIP is built from `dist/` and includes the compiled extension pages, service worker, content script, assets, and icons.

Before each version update, smoke-test missing API key handling, recipe detection, AI processing, PDF download, and the packaged icons.

## Project Structure

```
src/
├── ai_translate.ts        # OpenAI translation with Estonian linguistic prompt
├── content_script.ts      # Injected script for recipe extraction
├── recipe_extractor.ts    # JSON-LD / microdata / DOM recipe parser
├── ingredient_parser.ts   # Quantity/unit/ingredient line parser
├── unit_converter.ts      # Metric ↔ imperial conversion with densities
├── gluten.ts              # GF keyword detection + deterministic substitutions
├── language_detect.ts     # Estonian vs English heuristic detection
├── pdf_renderer.ts        # jsPDF A4 recipe card builder
├── service_worker.ts      # MV3 background: orchestration pipeline
├── shared_types.ts        # Shared TypeScript interfaces
├── openai_client.ts       # Legacy single-shot pipeline (unused)
├── styles.css             # Shared UI styles (Inter font, toggles, cards)
├── popup/
│   └── popup.tsx          # Extension popup React app
├── options/
│   └── options.tsx        # Settings page React app
├── offscreen/
│   └── offscreen.ts       # Offscreen document for PDF rendering
└── __tests__/
    ├── gluten.test.ts
    ├── unit_converter.test.ts
    └── ingredient_parser.test.ts
```

## License

ISC
