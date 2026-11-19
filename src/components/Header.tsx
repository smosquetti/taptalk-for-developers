"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSound } from "@/components/SoundContext";

const NAV = [
  { href: "/", label: "Board" },
  { href: "/quiz", label: "Quiz" },
  { href: "/speak-quiz", label: "Speak" },
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

// Compare on the page name: the last path segment, minus a trailing ".html".
// The APK build (android/build-apk.sh) rewrites the nav hrefs to relative
// files — "/quiz" -> "quiz.html", href:"/" -> "index.html" — so at runtime
// the NAV hrefs differ from the dev-server ones. The name is identical in
// every form: /quiz, quiz.html and /webapp/quiz.html all give "quiz".
function pageName(value: string): string {
  const segment = value.split("/").filter(Boolean).pop() ?? "";
  return segment.endsWith(".html") ? segment.slice(0, -5) : segment;
}

function isActive(
  item: (typeof NAV)[number],
  path: string,
): boolean {
  return pageName(item.href) === pageName(path);
}

export default function Header() {
  const routerPath = usePathname();
  const { on, toggle } = useSound();
  // In the APK every page is a full document load at
  // https://appassets.taptalk.local/webapp/<name>.html. usePathname() is
  // derived from the router state and settles to the wrong value right after
  // a fresh top-level page load (the Speak pill would flash on then off), so
  // on the client read the browser's real path — the ground truth for which
  // page is open — and only fall back to usePathname() on the server, where
  // window is unavailable. The name check below maps both the baked route
  // (/speak-quiz) and the real URL (/webapp/speak-quiz.html) to the same
  // active styling, so the client's first render matches the server HTML.
  const currentPath =
    typeof window !== "undefined" ? window.location.pathname : routerPath;

  return (
    <header className="sticky top-0 z-30 border-b border-edge bg-void/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link
          href="/" className="flex items-center gap-2.5 text-xl font-bold tracking-tight text-ice">
          <TerminalMark />
        </Link>

        <nav className="flex items-center gap-2" aria-label="Main">
          {NAV.map((item) => {
            const active = isActive(item, currentPath);
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
