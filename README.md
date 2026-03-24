# CookbookLM

A Chrome extension that extracts recipes from any webpage, translates them into idiomatic Estonian, converts measurements to metric, and generates a beautifully formatted A4 PDF — ready to print and use in the kitchen.

## Features

- **Recipe extraction** — Parses structured data (JSON-LD, microdata) and falls back to DOM heuristics
- **AI-powered translation** — Uses OpenAI (GPT-5.4) with deep Estonian culinary linguistics: correct grammar (käskiv kõneviis, partitive case), natural cooking verbs, and proper ingredient names
- **Unit conversion** — Automatic imperial → metric conversion with density-aware volume-to-weight (cups → grams) for 30+ ingredients
- **Gluten-free mode** — Deterministic ingredient swaps + AI reasoning about achieving the same culinary result with GF alternatives, with safety warnings
- **PDF generation** — Clean A4 layout with hero image, two-column ingredients, numbered steps, substitutions section, QR code linking to the source, and page numbers
- **Caching** — Translations are cached locally (SHA-256 keyed) to avoid repeated API calls
- **Measurement system choice** — Metric or imperial output
- **Language detection** — Skips translation when the recipe is already in Estonian

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
4. Click the extension icon and go to **Seaded** (Settings) to enter your OpenAI API key

### Development

```powershell
npm run build       # Full production build
npm run typecheck   # TypeScript type checking
npm test            # Run unit tests (vitest)
```

After rebuilding, refresh the extension on `chrome://extensions/` to pick up changes.

## Usage

1. Navigate to any recipe page (e.g. AllRecipes, BBC Good Food, Nami-Nami)
2. Click the CookbookLM extension icon
3. Click **Tuvasta retsept** to extract, or **Genereeri PDF** to extract + translate + download in one step
4. Toggle **Gluteenivaba** for gluten-free adaptation with substitutions and safety warnings
5. Toggle **Lisa asendused** to include ingredient substitution suggestions
6. The PDF downloads automatically to your Downloads folder

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
