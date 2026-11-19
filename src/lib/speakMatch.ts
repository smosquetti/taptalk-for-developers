// Token-level matching for the Speak quiz.
//
// The target is the full phrase (article + word, e.g. "der Computer");
// the recognized text is checked against it token by token so the review
// can show which part the user got right (green) and which wrong
// (red) — e.g. article wrong + word right.

export type TokenResult = {
  text: string;
  correct: boolean;
};

export type MatchResult = {
  /** True when every target token (article included) was spoken. */
  ok: boolean;
  tokens: TokenResult[];
};

const ARTICLES = new Set(["der", "die", "das", "den", "dem"]);

/** True when `token` is a German article (after normalization). */
export function isArticle(raw: string): boolean {
  return ARTICLES.has(normalizeToken(raw));
}

/** Lowercase and keep only letters (umlauts included). */
export function normalizeToken(raw: string): string {
  return raw.toLowerCase().replace(/[^a-zäöüß]/g, "");
}

/**
 * Umlaut-spelling-lenient key: ä≈ae, ö≈oe, ü≈ue, ß≈ss, so
 * "Grüße" and "gruesse" compare equal on both sides.
 */
function matchKey(token: string): string {
  return normalizeToken(token)
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

/**
 * Greedy in-order match of the target's tokens against the recognized
 * tokens: each target token must find a (later) recognized token with
 * the same key. Word order matters — "Computer der" is not the same as
 * "der Computer". Extra words in the recognition are ignored.
 */
export function matchPhrase(target: string, heard: string[]): MatchResult {
  const targetTokens = target.split(/\s+/).filter(Boolean);
  // Each heard result is a full phrase — split it into words before
  // normalizing, otherwise normalizeToken strips the spaces and a
  // multi-word result collapses into a single unmatchable token
  // ("die Tabelle" -> "dietetabelle").
  const heardTokens = heard
    .flatMap((s) => s.split(/\s+/))
    .map(normalizeToken)
    .filter(Boolean);

  let heardIdx = 0;
  const tokens: TokenResult[] = targetTokens.map((raw) => {
    const key = matchKey(raw);
    let found = false;
    while (heardIdx < heardTokens.length) {
      if (matchKey(heardTokens[heardIdx]) === key) {
        found = true;
        heardIdx++;
        break;
      }
      heardIdx++;
    }
    return { text: raw, correct: found };
  });

  return { ok: tokens.every((t) => t.correct), tokens };
}
