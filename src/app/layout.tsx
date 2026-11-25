import type { Metadata } from "next";
import { Space_Grotesk, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SoundProvider } from "@/components/SoundContext";
import Header from "@/components/Header";

const display = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
});

const mono = Geist_Mono({
  variable: "--font-mono-next",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TapTalk — German for Developers",
  description:
    "Learn German for software developers: terms with articles, example sentences, and browser audio. Tap a card to hear it; quiz yourself in listen or read mode.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-void text-ice">
        <SoundProvider>
          <Header />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
            {children}
          </main>
          <footer className="pb-8 text-center font-mono text-xs text-fog">
            TapTalk · German for software developers · Web Speech
            API audio
          </footer>
        </SoundProvider>
      </body>
    </html>
  );
}
