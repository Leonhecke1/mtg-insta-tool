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
