import { describe, expect, test } from "vitest";
import { renderRecipePdfArrayBuffer } from "../pdf_renderer";
import type { RecipeEtResult } from "../shared_types";

function recipe(): RecipeEtResult {
  return {
    title_et: "Printable Soup",
    source_url: "https://example.test/soup",
    source_domain: "example.test",
    servings: "4",
    times: { prep: "10 min", cook: "20 min", total: "30 min" },
    ingredients: [
      { original: "2 cups potatoes", et: "2 cups potatoes" },
      { original: "1 cup milk", et: "1 cup milk" },
      { original: "2 tbsp flour", et: "2 tbsp certified gluten-free flour blend" },
    ],
    steps: [
      { original: "Boil potatoes.", et: "Boil potatoes." },
      { original: "Whisk in thickener.", et: "Whisk in the gluten-free flour blend until smooth." },
    ],
    substitutions: [
      {
        ingredient: "flour",
        suggestions_et: ["certified gluten-free all-purpose flour blend", "cornstarch slurry"],
        note_et: "Common grocery or specialty items; use certified gluten-free labels for celiac safety.",
      },
    ],
    warnings_et: ["Use certified gluten-free products and avoid cross-contact."],
  };
}

describe("pdf_renderer", () => {
  test("renders a printable English PDF array buffer", async () => {
    const buffer = await renderRecipePdfArrayBuffer(recipe(), undefined, { pageFormat: "letter", language: "en" });
    const header = new TextDecoder().decode(new Uint8Array(buffer.slice(0, 8)));

    expect(buffer.byteLength).toBeGreaterThan(1000);
    expect(header).toContain("%PDF");
  });

  test("renders all supported page sizes without throwing", async () => {
    for (const pageFormat of ["a4", "letter", "legal", "a5"] as const) {
      const buffer = await renderRecipePdfArrayBuffer(recipe(), undefined, { pageFormat, language: "en" });
      expect(buffer.byteLength).toBeGreaterThan(1000);
    }
  });
});
