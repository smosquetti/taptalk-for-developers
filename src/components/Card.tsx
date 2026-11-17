"use client";

import { CATEGORIES, type WordCard } from "@/lib/vocabulary";

type Props = {
  card: WordCard;
  onPick: (card: WordCard) => void;
};

export default function Card({ card, onPick }: Props) {
  const [article, ...rest] = card.german.split(" ");
  const icon = CATEGORIES.find((c) => c.id === card.category)?.icon;

  return (
    <button
      type="button"
      onClick={() => onPick(card)}
      aria-label={`${card.german} — ${card.english}`}
      className="group flex min-h-32 w-full flex-col justify-between gap-2 rounded-xl border border-edge bg-panel p-4 text-left transition duration-150 hover:border-neon/70 hover:shadow-[0_0_22px_rgba(34,211,238,0.18)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon active:scale-[0.98]"
    >
      <div className="flex items-start justify-between gap-2">
        <span
          lang="de"
          className="font-mono text-lg font-semibold leading-snug text-ice"
        >
          <span className="text-neon">{article}</span>
          {rest.length > 0 && <span> {rest.join(" ")}</span>}
        </span>
        {icon && (
          <span aria-hidden className="text-base opacity-60 transition group-hover:opacity-100">
            {icon}
          </span>
        )}
      </div>
      <span className="font-mono text-xs text-fog">{card.english}</span>
    </button>
  );
}
