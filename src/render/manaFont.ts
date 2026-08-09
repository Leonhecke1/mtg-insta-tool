import * as fs from "fs";
import * as path from "path";

let cached: string | null = null;

const FONT_EXT_MIME: Record<string, string> = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".svg": "image/svg+xml",
};

/**
 * Laedt das mana-font CSS (Mana-Symbole von Andrew Gioia,
 * https://mana.andrewgioia.com) und ersetzt alle relativen url(...)
 * Font-Referenzen durch data: URIs, damit Puppeteer sie unabhaengig vom
 * Arbeitsverzeichnis rendern kann. Ergebnis wird pro Prozess gecacht.
 */
export function loadManaFontCss(): string {
  if (cached) return cached;

  let pkgJsonPath: string;
  try {
    pkgJsonPath = require.resolve("mana-font/package.json");
  } catch {
    console.warn(
      "[manaFont] Paket 'mana-font' nicht gefunden (npm install ausgefuehrt?) - Mana-Symbole werden als Fallback-Text gerendert."
    );
    cached = "";
    return cached;
  }

  const pkgRoot = path.dirname(pkgJsonPath);
  const cssCandidates = [
    path.join(pkgRoot, "css", "mana.css"),
    path.join(pkgRoot, "dist", "mana.css"),
    path.join(pkgRoot, "mana.css"),
  ];
  const cssPath = cssCandidates.find((p) => fs.existsSync(p));
  if (!cssPath) {
    console.warn("[manaFont] mana.css nicht gefunden unter", pkgRoot);
    cached = "";
    return cached;
  }

  let css = fs.readFileSync(cssPath, "utf-8");
  const cssDir = path.dirname(cssPath);

  css = css.replace(/url\((['"]?)([^'")]+)\1\)/g, (match, _q, relPath: string) => {
    const cleanPath = relPath.split("?")[0].split("#")[0];
    const ext = path.extname(cleanPath).toLowerCase();
    const mime = FONT_EXT_MIME[ext];
    if (!mime) return match;

    const absPath = path.resolve(cssDir, cleanPath);
    if (!fs.existsSync(absPath)) return match;

    const base64 = fs.readFileSync(absPath).toString("base64");
    return `url("data:${mime};base64,${base64}")`;
  });

  cached = css;
  return cached;
}
