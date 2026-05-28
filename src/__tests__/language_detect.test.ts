import { describe, expect, test } from "vitest";
import { detectLanguageFromTexts } from "../language_detect";

describe("language_detect", () => {
  test("detects Estonian recipe text from diacritics and cooking words", () => {
    expect(detectLanguageFromTexts([
      "Kuldne kartulisupp",
      "Lisa sibul ja küüslauk ning keeda tasasel tulel.",
      "Serveeri soojalt.",
    ])).toBe("et");
  });

  test("detects English recipe text from common cooking words", () => {
    expect(detectLanguageFromTexts([
      "Chicken soup",
      "Add the onion and garlic, then simmer until the chicken is cooked.",
      "Serve with pepper.",
    ])).toBe("en");
  });

  test("returns unknown for too little or ambiguous text", () => {
    expect(detectLanguageFromTexts(["Soup"])).toBe("unknown");
  });
});
