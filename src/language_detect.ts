export type Lang = "et" | "en" | "unknown";

const ET_CHARS = /[õäöüšž]/i;

const ET_STOPWORDS = [
  // common Estonian recipe words / function words
  "ja", "või", "ning", "kuid", "aga", "siis", "veel", "juba", "ka",
  "umbes", "kuumuta", "lisa", "sega", "küpseta", "keeda",
  "minutit", "kuni", "järel", "tõsta", "prae", "hauta",
  "soola", "pipar", "pann", "kastme", "kaste", "maitse",
  "serveeri", "tassi", "tl", "sl", "ahjus", "segades",
  "lase", "kata", "tükki", "peeneks", "seejärel",
  "vahusta", "sõtku", "nõruta", "vala", "haki",
  "kergelt", "pehmeks", "kuldpruuniks", "toasoojale",
  "jahu", "suhkur", "muna", "sibul", "küüslauk", "koor",
  "või", "piim", "vesi", "liha", "kana", "kartul",
  "nuga", "kauss", "pott", "ahi", "plaat", "pliit",
];

const EN_STOPWORDS = [
  // common English recipe words / function words
  "and", "or", "the", "then", "this", "with", "into", "from", "about",
  "heat", "add", "stir", "mix", "bake", "cook", "pour",
  "minutes", "until", "remove", "place", "combine",
  "salt", "pepper", "pan", "sauce", "serve",
  "cup", "cups", "tsp", "tbsp", "oven", "degrees",
  "preheat", "whisk", "drain", "slice", "chop",
  "medium", "large", "small", "fresh", "finely",
  "butter", "sugar", "flour", "eggs", "milk", "cream",
  "onion", "garlic", "chicken", "beef", "water",
  "bowl", "pot", "skillet", "baking", "sheet",
];

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .split(/[^a-zA-Zõäöüšž]+/i)
    .filter((t) => t.length > 1);
}

export function detectLanguageFromTexts(texts: string[]): Lang {
  const joined = texts.join(" ").slice(0, 8000);

  // Estonian special characters are a very strong signal
  const etCharMatches = (joined.match(ET_CHARS) || []).length;
  if (etCharMatches >= 3) return "et";

  const toks = tokenize(joined);
  if (toks.length < 3) return "unknown";

  const freq = new Map<string, number>();
  for (const t of toks) freq.set(t, (freq.get(t) || 0) + 1);

  let etScore = 0;
  let enScore = 0;
  for (const w of ET_STOPWORDS) {
    const c = freq.get(w) || 0;
    if (c > 0) etScore += Math.min(c, 3);
  }
  for (const w of EN_STOPWORDS) {
    const c = freq.get(w) || 0;
    if (c > 0) enScore += Math.min(c, 3);
  }

  // "the" is an extremely strong English signal — Estonian has no articles
  if (freq.has("the")) enScore += 5;

  // Single special character is still a decent ET signal
  if (etCharMatches >= 1) etScore += 4;

  if (etScore >= enScore + 3) return "et";
  if (enScore >= etScore + 3) return "en";

  // When ambiguous, lean toward "unknown" to let the pipeline decide
  return "unknown";
}
