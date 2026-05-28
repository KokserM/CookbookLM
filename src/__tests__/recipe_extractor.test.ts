import { describe, expect, test } from "vitest";
import { JSDOM } from "jsdom";
import { extractRecipeFromDocument, getExtractionDebugSummary } from "../recipe_extractor";

describe("recipe_extractor", () => {
  test("extracts Estonian article-style recipes", () => {
    const doc = new JSDOM(
      `
      <article>
        <h1>Kuldne kartulisupp</h1>
        <p>Kogus: neljale</p>
        <p>Koostisosad 4 tk Kartul 1 tk Varsseller 1 tk Harilik sibul 2 tl Jahu 3.5 dl Piim 200 g Riivjuust</p>
        <p>Valmistamine Pane suurde potti tükeldatud kartul ja vesi. Sega väikeses kausis jahu ja piim ning lisa supile pidevalt segades, kuni supp pakseneb. Serveeri kohe.</p>
        <h2>Kommentaarid</h2>
      </article>
      `,
    ).window.document;

    const out = extractRecipeFromDocument(doc, "https://example.test/retsept");
    expect(out?.title).toBe("Kuldne kartulisupp");
    expect(out?.servings).toBe("neljale");
    expect(out?.ingredients.length).toBeGreaterThanOrEqual(5);
    expect(out?.ingredients).toContain("2 tl Jahu");
    expect(out?.steps.length).toBeGreaterThanOrEqual(2);
  });

  test("prefers complete JSON-LD recipe data and parses metadata", () => {
    const doc = new JSDOM(`
      <html>
        <head>
          <title>Fallback title</title>
          <meta property="og:image" content="https://example.test/hero.jpg">
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@graph": [
                { "@type": "WebPage", "name": "Not a recipe" },
                {
                  "@type": "Recipe",
                  "name": "Lemon Chicken",
                  "recipeYield": "4 servings",
                  "prepTime": "PT15M",
                  "cookTime": "PT30M",
                  "totalTime": "PT45M",
                  "image": { "url": "https://example.test/chicken.jpg" },
                  "recipeIngredient": ["1 lb chicken", "2 tbsp lemon juice", "Salt"],
                  "recipeInstructions": [
                    { "@type": "HowToStep", "text": "Season the chicken." },
                    { "@type": "HowToStep", "text": "Bake until cooked through." }
                  ]
                }
              ]
            }
          </script>
        </head>
        <body></body>
      </html>
    `).window.document;

    const out = extractRecipeFromDocument(doc, "https://example.test/lemon-chicken");

    expect(out?.title).toBe("Lemon Chicken");
    expect(out?.servings).toBe("4 servings");
    expect(out?.times?.prep).toBe("15 min");
    expect(out?.times?.cook).toBe("30 min");
    expect(out?.times?.total).toBe("45 min");
    expect(out?.hero_image_url).toBe("https://example.test/chicken.jpg");
    expect(out?.ingredients).toEqual(["1 lb chicken", "2 tbsp lemon juice", "Salt"]);
    expect(out?.steps).toEqual(["Season the chicken.", "Bake until cooked through."]);
  });

  test("extracts schema.org microdata recipes", () => {
    const doc = new JSDOM(`
      <article itemscope itemtype="https://schema.org/Recipe">
        <h1 itemprop="name">Pasta Bake</h1>
        <span itemprop="recipeYield">6</span>
        <time itemprop="totalTime">1 h</time>
        <ul>
          <li itemprop="recipeIngredient">250 g pasta</li>
          <li itemprop="recipeIngredient">200 g cheese</li>
          <li itemprop="recipeIngredient">1 cup tomato sauce</li>
        </ul>
        <ol>
          <li itemprop="recipeInstructions">Boil the pasta.</li>
          <li itemprop="recipeInstructions">Bake with sauce and cheese.</li>
        </ol>
      </article>
    `).window.document;

    const out = extractRecipeFromDocument(doc, "https://example.test/pasta");

    expect(out?.title).toBe("Pasta Bake");
    expect(out?.servings).toBe("6");
    expect(out?.times?.total).toBe("1 h");
    expect(out?.ingredients).toHaveLength(3);
    expect(out?.steps).toHaveLength(2);
  });

  test("falls back to common recipe class heuristics", () => {
    const doc = new JSDOM(`
      <main>
        <h1>Simple Pancakes</h1>
        <ul class="ingredients">
          <li>1 cup flour</li>
          <li>1 cup milk</li>
          <li>1 egg</li>
        </ul>
        <ol class="instructions">
          <li>Mix the batter.</li>
          <li>Cook in a hot pan.</li>
          <li>Serve warm.</li>
        </ol>
      </main>
    `).window.document;

    const out = extractRecipeFromDocument(doc, "https://example.test/pancakes");

    expect(out?.title).toBe("Simple Pancakes");
    expect(out?.ingredients).toEqual(["1 cup flour", "1 cup milk", "1 egg"]);
    expect(out?.steps).toEqual(["Mix the batter.", "Cook in a hot pan.", "Serve warm."]);
    expect(getExtractionDebugSummary(out)).toContain("ingredients=3");
  });

  test("returns null and debug summary for non-recipe pages", () => {
    const doc = new JSDOM(`<main><h1>About us</h1><p>No cooking here.</p></main>`).window.document;
    const out = extractRecipeFromDocument(doc, "https://example.test/about");

    expect(out).toBeNull();
    expect(getExtractionDebugSummary(out)).toBe("no recipe");
  });
});
