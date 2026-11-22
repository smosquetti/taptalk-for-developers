import { readFileSync } from "node:fs";
import path from "node:path";

export interface VocabWord {
  id: string;
  category: string;
  german: string;
  english: string;
  exampleDe: string;
  exampleEn: string;
}

let cached: VocabWord[] | null = null;

/** Load public/vocabulary.json (run Playwright from the project root). */
export function loadVocabulary(): VocabWord[] {
  if (cached) return cached;
  const file = path.resolve(process.cwd(), "public/vocabulary.json");
  cached = JSON.parse(readFileSync(file, "utf8")) as VocabWord[];
  return cached;
}

/** Words of one category, in file order. */
export function categoryWords(category: string): VocabWord[] {
  return loadVocabulary().filter((w) => w.category === category);
}

/**
 * The quiz/speak-quiz tests always use the `privacy` category: it has 24
 * words, exactly one without an article (so at least one hidden-article
 * round is forced by buildQuestions) and no duplicate English strings
 * (so an answer option's text identifies one word unambiguously).
 */
export const PRIVACY = "privacy" as const;
