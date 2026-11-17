export type CategoryId =
  | "hardware"
  | "fundamentals"
  | "control-flow"
  | "development"
  | "oop"
  | "web"
  | "security-ops"
  | "workplace"
  | "devops"
  | "qa"
  | "architecture"
  | "advanced"
  | "networking"
  | "data"
  | "privacy"
  | "ai"
  | "product";

export type WordCard = {
  id: string;
  category: CategoryId;
  german: string;
  english: string;
  exampleDe: string;
  exampleEn: string;
};

export type CategoryInfo = {
  id: CategoryId;
  label: string;
  icon: string;
};

export const CATEGORIES: CategoryInfo[] = [
  { id: "hardware", label: "Hardware", icon: "💻" },
  { id: "fundamentals", label: "Fundamentals", icon: "🧮" },
  { id: "control-flow", label: "Control Flow", icon: "🔀" },
  { id: "development", label: "Development", icon: "🛠️" },
  { id: "oop", label: "OOP", icon: "🧬" },
  { id: "web", label: "Web & DB", icon: "🌐" },
  { id: "security-ops", label: "Security Ops", icon: "🛡️" },
  { id: "workplace", label: "Workplace", icon: "👥" },
  { id: "devops", label: "DevOps", icon: "🚀" },
  { id: "qa", label: "Testing", icon: "✅" },
  { id: "architecture", label: "Architecture", icon: "🏗️" },
  { id: "advanced", label: "Advanced", icon: "⚡" },
  { id: "networking", label: "Networking", icon: "📡" },
  { id: "data", label: "Data Eng", icon: "🗃️" },
  { id: "privacy", label: "Privacy", icon: "🔐" },
  { id: "ai", label: "AI / ML", icon: "🤖" },
  { id: "product", label: "Product", icon: "🎨" },
];

const cache = new Map<string, WordCard[]>();

/**
 * Loads the vocabulary list from public/vocabulary.json.
 * Kept client-side on purpose: the JSON stays editable without rebuilding.
 */
export async function loadVocabulary(): Promise<WordCard[]> {
  const hit = cache.get("de");
  if (hit) return hit;
  const res = await fetch("/vocabulary.json");
  if (!res.ok) {
    throw new Error(`Could not load vocabulary.json (HTTP ${res.status})`);
  }
  const data = (await res.json()) as WordCard[];
  cache.set("de", data);
  return data;
}

export function shuffle<T>(input: readonly T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
