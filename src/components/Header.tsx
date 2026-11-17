"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSound } from "@/components/SoundContext";

const NAV = [
  { href: "/", label: "Board" },
  { href: "/quiz", label: "Quiz" },
] as const;

function TerminalMark() {
  return (
    <span
      aria-hidden
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-neon/60 bg-surface shadow-[0_0_18px_rgba(34,211,238,0.35)]"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5 text-neon"
      >
        <path d="M5 7l5 5-5 5" />
        <path d="M13 17h6" />
      </svg>
    </span>
  );
}

export default function Header() {
  const pathname = usePathname();
  const { on, toggle } = useSound();

  return (
    <header className="sticky top-0 z-30 border-b border-edge bg-void/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-xl font-bold tracking-tight text-ice"
        >
          <TerminalMark />
          <span className="flex items-center gap-2">
            TapTalk
            <span className="hidden rounded border border-neon/50 bg-surface px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-neon sm:inline-flex">
              DE · DEV
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-2" aria-label="Main">
          {NAV.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-full px-3 py-2 text-sm font-semibold transition sm:px-4 ${
                  active
                    ? "border border-neon/70 bg-surface text-neon shadow-[0_0_14px_rgba(34,211,238,0.25)]"
                    : "border border-edge text-fog hover:text-ice"
                }`}
              >
                {item.label}
              </Link>
            );
          })}

          <button
            type="button"
            onClick={toggle}
            aria-pressed={on}
            aria-label={on ? "Turn sound off" : "Turn sound on"}
            className={`ml-1 flex h-10 w-10 items-center justify-center rounded-full border text-lg transition ${
              on
                ? "border-neon/60 bg-surface text-mint"
                : "border-edge bg-void text-fog opacity-70"
            }`}
          >
            <span aria-hidden>{on ? "🔊" : "🔇"}</span>
          </button>
        </nav>
      </div>
    </header>
  );
}
