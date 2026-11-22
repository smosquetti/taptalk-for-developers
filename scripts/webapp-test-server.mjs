// Serves the APK asset layout of the web app to the Playwright suite.
//
// The WebView loads the app from https://appassets.taptalk.local/webapp/,
// where every page is a full document load and every asset URL is relative
// (android/build-apk.sh rewrites the static export). Testing the raw export
// at a server root would pass while the APK is broken — root-absolute URLs
// resolve fine there but fail under the /webapp/ path. So this server:
//
//   1. builds the static export if out/ is missing or stale,
//   2. copies it to .webapp/ (gitignored) and applies the exact URL
//      rewrites from android/build-apk.sh (step [3/5]) — keep in sync,
//   3. serves it under /webapp/ like the WebView's asset origin.

import { createServer } from "node:http";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "out");
const webappDir = path.join(root, ".webapp");
const port = Number(process.env.WEBAPP_TEST_PORT ?? 8473);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

// ---------------------------------------------------------------------------
// Build: rebuild out/ when the static export is missing or older than the
// sources that feed it.
// ---------------------------------------------------------------------------

function sourceFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(p));
    else if (/\.(ts|tsx|css|json)$/.test(entry.name)) files.push(p);
  }
  return files;
}

function needsBuild() {
  if (process.env.WEBAPP_FORCE_BUILD === "1") return true;
  const outIndex = path.join(outDir, "index.html");
  if (!existsSync(outIndex)) return true;
  const outMtime = statSync(outIndex).mtimeMs;
  const inputs = [
    ...sourceFiles(path.join(root, "src")),
    path.join(root, "public", "vocabulary.json"),
    path.join(root, "next.config.ts"),
    path.join(root, "package.json"),
  ];
  return inputs.some((f) => statSync(f).mtimeMs > outMtime);
}

// ---------------------------------------------------------------------------
// Rewrites: exact port of the sed step [3/5] in android/build-apk.sh.
// ---------------------------------------------------------------------------

// Root-level HTML pages: asset refs, favicon, nav anchors. The bare home
// link only occurs as the full attribute href="/".
function rewriteHtml(text) {
  return text
    .replaceAll('"/_next/', '"_next/')
    .replaceAll('"/quiz"', '"quiz.html"')
    .replaceAll('"/speak-quiz"', '"speak-quiz.html"')
    .replaceAll('"/favicon', '"_favicon')
    .replaceAll('href="/"', 'href="index.html"');
}

// JS chunks: Turbopack chunk base path, vocabulary fetch, client-side nav
// links (deliberately NO bare '"/"' rewrite — Next internals use it as
// path logic).
function rewriteJs(text) {
  return text
    .replaceAll('"/_next/', '"_next/')
    .replaceAll('"/quiz"', '"quiz.html"')
    .replaceAll('"/speak-quiz"', '"speak-quiz.html"')
    .replaceAll('"/vocabulary.json"', '"vocabulary.json"')
    .replaceAll('href:"/"', 'href:"index.html"');
}

async function buildWebapp() {
  await rm(webappDir, { recursive: true, force: true });
  await mkdir(webappDir, { recursive: true });
  await cp(outDir, webappDir, { recursive: true });

  for (const entry of await readdir(webappDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".html")) {
      const file = path.join(webappDir, entry.name);
      await writeFile(file, rewriteHtml(await readFile(file, "utf8")));
    }
  }
  const chunksDir = path.join(webappDir, "_next", "static", "chunks");
  if (existsSync(chunksDir)) {
    for (const entry of await readdir(chunksDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".js")) {
        const file = path.join(chunksDir, entry.name);
        await writeFile(file, rewriteJs(await readFile(file, "utf8")));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Serve .webapp/ under the /webapp/ prefix, like the WebView asset origin.
// ---------------------------------------------------------------------------

function serve(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url ?? "/", `http://127.0.0.1:${port}`).pathname);
  } catch {
    res.writeHead(400);
    return res.end("Bad request");
  }
  if (urlPath === "/webapp" || urlPath === "/webapp/") urlPath = "/webapp/index.html";
  if (!urlPath.startsWith("/webapp/")) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not found — the app lives under /webapp/");
  }
  const file = path.join(webappDir, urlPath.slice("/webapp/".length));
  if (!file.startsWith(webappDir) || !existsSync(file) || !statSync(file).isFile()) {
    const fallback = path.join(webappDir, "404.html");
    if (existsSync(fallback)) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      return readFile(fallback).then((b) => res.end(b)).catch(() => res.end("Not found"));
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not found");
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
  readFile(file).then((b) => res.end(b)).catch(() => res.end());
}

async function main() {
  if (needsBuild()) {
    console.log("==> static export missing or stale — building out/ (npm run build)");
    execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
  } else {
    console.log("==> static export up to date");
  }
  await buildWebapp();
  console.log(`==> applying build-apk.sh URL rewrites to ${path.relative(root, webappDir)}/`);
  createServer(serve).listen(port, "127.0.0.1", () => {
    console.log(`> webapp test server at http://127.0.0.1:${port}/webapp/ (APK asset layout)`);
  });
}

await main();
