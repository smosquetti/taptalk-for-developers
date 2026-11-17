"use client";

import type { CategoryId, CategoryInfo } from "@/lib/vocabulary";

type Props = {
  categories: CategoryInfo[];
  active: CategoryId | "all";
  onSelect: (id: CategoryId | "all") => void;
};

export default function CategoryBar({ categories, active, onSelect }: Props) {
  return (
    <nav
      aria-label="Categories"
      className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-2"
    >
      <Chip label="All" icon="▦" active={active === "all"} onClick={() => onSelect("all")} />
      {categories.map((c) => (
        <Chip
          key={c.id}
          label={c.label}
          icon={c.icon}
          active={active === c.id}
          onClick={() => onSelect(c.id)}
        />
      ))}
    </nav>
  );
}

function Chip({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition ${
        active
          ? "border-neon/80 bg-surface text-neon shadow-[0_0_14px_rgba(34,211,238,0.25)]"
          : "border-edge bg-panel text-fog hover:border-neon/40 hover:text-ice"
      }`}
    >
      <span aria-hidden className="text-xs">{icon}</span>
      {label}
    </button>
  );
}
