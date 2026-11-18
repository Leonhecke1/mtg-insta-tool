import * as fs from "fs";
import * as path from "path";
import puppeteer, { Browser } from "puppeteer";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "./theme";

/**
 * Rendert eine Liste von Slide-HTML-Dokumenten zu PNG-Dateien
 * (1080x1350, siehe SPEC.md Rendering-Pipeline). Nutzt einen einzigen
 * Browser/Page fuer alle Slides einer Deck-Tech (schneller als pro Slide
 * neu zu starten).
 */
export async function renderSlidesToFiles(
  htmlSlides: string[],
  outDir: string
): Promise<string[]> {
  fs.mkdirSync(outDir, { recursive: true });

  let browser: Browser | null = null;
  const files: string[] = [];

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setViewport({
      width: SLIDE_WIDTH,
      height: SLIDE_HEIGHT,
      deviceScaleFactor: 1,
    });

    for (let i = 0; i < htmlSlides.length; i++) {
      const html = htmlSlides[i];
      await page.setContent(html, { waitUntil: "networkidle0", timeout: 60_000 });

      const fileName = `slide-${String(i + 1).padStart(2, "0")}.png`;
      const filePath = path.join(outDir, fileName);
      await page.screenshot({
        path: filePath as `${string}.png`,
        type: "png",
        clip: { x: 0, y: 0, width: SLIDE_WIDTH, height: SLIDE_HEIGHT },
      });
      files.push(filePath);
    }
  } finally {
    if (browser) await browser.close();
  }

  return files;
}

/**
 * Die Instagram-API akzeptiert fuer Bilder nur JPEG. Erzeugt zu jeder PNG
 * eine gleichnamige .jpg daneben (falls noch nicht vorhanden) und gibt die
 * JPEG-Pfade in derselben Reihenfolge zurueck.
 */
export async function ensureJpegs(pngFiles: string[]): Promise<string[]> {
  const jpgFiles = pngFiles.map((f) => f.replace(/\.png$/i, ".jpg"));
  const missing = pngFiles.filter((_, i) => !fs.existsSync(jpgFiles[i]));
  if (missing.length === 0) return jpgFiles;

  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: SLIDE_WIDTH, height: SLIDE_HEIGHT, deviceScaleFactor: 1 });

    for (let i = 0; i < pngFiles.length; i++) {
      if (fs.existsSync(jpgFiles[i])) continue;
      const b64 = fs.readFileSync(pngFiles[i]).toString("base64");
      await page.setContent(
        `<html><body style="margin:0"><img src="data:image/png;base64,${b64}" style="display:block;width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px"></body></html>`,
        { waitUntil: "load" }
      );
      await page.screenshot({
        path: jpgFiles[i] as `${string}.jpeg`,
        type: "jpeg",
        quality: 92,
        clip: { x: 0, y: 0, width: SLIDE_WIDTH, height: SLIDE_HEIGHT },
      });
    }
  } finally {
    if (browser) await browser.close();
  }
  return jpgFiles;
}
