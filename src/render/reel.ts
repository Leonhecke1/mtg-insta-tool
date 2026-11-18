import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import puppeteer, { Browser } from "puppeteer";
import { Deck } from "../types";
import { escapeHtml } from "./components";
import { FONT_STACK } from "./theme";

// ffmpeg-static exportiert den Pfad zur mitgelieferten ffmpeg-Binary
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string | null = require("ffmpeg-static");

const run = promisify(execFile);

const W = 1080;
const H = 1920;
const FPS = 30;

/**
 * Faceless "Karte als Hauptmotiv"-Reel (siehe ~/.claude/instagram/swipe.md):
 *  1. Hook-Frame: Commander-Karte gross auf geblurrtem Artwork, Hook als
 *     grosse Text-Box oben (muss in < 1 s lesbar sein)
 *  2. danach die Deck-Tech-Slides, jeweils auf geblurrtem Artwork
 * Jeder Frame bekommt einen langsamen Zoom. Tonspur ist still - Trend-Audio
 * kann die API nicht setzen.
 */
export interface ReelOptions {
  hook: string;
  /** Slides (1-basiert), die nach dem Hook kommen. Default: 2..6 */
  slides?: number[];
  hookSeconds?: number;
  slideSeconds?: number;
}

function toDataUri(file: string): string {
  const ext = path.extname(file).slice(1).toLowerCase().replace("jpg", "jpeg");
  return `data:image/${ext};base64,${fs.readFileSync(file).toString("base64")}`;
}

function backdrop(artUrl: string | null): string {
  return artUrl
    ? `<div style="position:absolute;inset:-60px;background:url('${escapeHtml(artUrl)}') center/cover;filter:blur(38px) brightness(0.45) saturate(1.2);"></div>`
    : `<div style="position:absolute;inset:0;background:#1F1D18;"></div>`;
}

function hookFrameHtml(deck: Deck, hook: string): string {
  const c = deck.commanders[0];
  const card = c?.imageNormal ?? c?.imageArtCrop ?? null;
  return `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;position:relative;font-family:${FONT_STACK.replace(/"/g, "'")};">
  ${backdrop(c?.imageArtCrop ?? card)}
  <div style="position:absolute;top:150px;left:70px;right:70px;text-align:center;">
    <span style="display:inline;background:#000;color:#fff;font-size:68px;font-weight:800;line-height:1.32;
      padding:6px 18px;box-decoration-break:clone;-webkit-box-decoration-break:clone;">${escapeHtml(hook)}</span>
  </div>
  ${
    card
      ? `<img src="${escapeHtml(card)}" style="position:absolute;left:50%;top:56%;transform:translate(-50%,-50%);
          width:760px;border-radius:38px;box-shadow:0 40px 90px rgba(0,0,0,0.6);">`
      : ""
  }
  <div style="position:absolute;bottom:90px;width:100%;text-align:center;color:rgba(255,255,255,0.75);font-size:34px;font-weight:600;">@floating.mana</div>
</body></html>`;
}

function slideFrameHtml(deck: Deck, slideFile: string): string {
  const c = deck.commanders[0];
  return `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;position:relative;">
  ${backdrop(c?.imageArtCrop ?? c?.imageNormal ?? null)}
  <img src="${toDataUri(slideFile)}" style="position:absolute;left:0;top:${(H - 1350) / 2}px;width:${W}px;height:1350px;box-shadow:0 30px 80px rgba(0,0,0,0.5);">
</body></html>`;
}

async function renderFrames(htmls: string[], outDir: string): Promise<string[]> {
  let browser: Browser | null = null;
  const files: string[] = [];
  try {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    for (let i = 0; i < htmls.length; i++) {
      await page.setContent(htmls[i], { waitUntil: "networkidle0", timeout: 60_000 });
      const file = path.join(outDir, `reel-frame-${String(i).padStart(2, "0")}.jpg`);
      await page.screenshot({ path: file as `${string}.jpeg`, type: "jpeg", quality: 92 });
      files.push(file);
    }
  } finally {
    if (browser) await browser.close();
  }
  return files;
}

export async function buildReel(
  deck: Deck,
  slideFiles: string[],
  jobDir: string,
  opts: ReelOptions
): Promise<string> {
  if (!ffmpegPath) throw new Error("ffmpeg-static binary not available on this platform");
  if (!opts.hook.trim()) throw new Error("Reel needs a hook text");

  const hookSec = opts.hookSeconds ?? 3.5;
  const slideSec = opts.slideSeconds ?? 2.5;
  const picked = (opts.slides ?? [2, 3, 4, 5, 6])
    .map((n) => slideFiles[n - 1])
    .filter((f): f is string => Boolean(f));

  const frames = await renderFrames(
    [hookFrameHtml(deck, opts.hook), ...picked.map((f) => slideFrameHtml(deck, f))],
    jobDir
  );
  const durations = frames.map((_, i) => (i === 0 ? hookSec : slideSec));
  const total = durations.reduce((a, b) => a + b, 0);

  const args: string[] = ["-y"];
  frames.forEach((f) => args.push("-i", f));
  args.push("-f", "lavfi", "-t", String(total), "-i", "anullsrc=r=44100:cl=stereo");

  const chains = frames.map((_, i) => {
    const n = Math.round(durations[i] * FPS);
    // langsamer Zoom von 1.00 auf ~1.06, zentriert
    return `[${i}:v]scale=${W * 2}:${H * 2},zoompan=z='1+0.06*on/${n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${n}:s=${W}x${H}:fps=${FPS},setsar=1[v${i}]`;
  });
  const concat = `${frames.map((_, i) => `[v${i}]`).join("")}concat=n=${frames.length}:v=1:a=0,format=yuv420p[v]`;

  const out = path.join(jobDir, "reel.mp4");
  args.push(
    "-filter_complex", [...chains, concat].join(";"),
    "-map", "[v]",
    "-map", `${frames.length}:a`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "128k",
    "-shortest", "-movflags", "+faststart",
    out
  );

  await run(ffmpegPath, args, { maxBuffer: 64 * 1024 * 1024 });
  frames.forEach((f) => fs.rmSync(f, { force: true }));
  return out;
}

/**
 * Story-Grafik "Neuer Post": Cover des Carousels gerahmt auf geblurrtem
 * Artwork mit "NEW POST"-Hinweis. Nicht klickbar - Beitrag teilen und
 * Link-Sticker kann die Instagram-API nicht.
 */
export async function buildNewPostStory(deck: Deck, coverFile: string, jobDir: string): Promise<string> {
  const c = deck.commanders[0];
  const font = FONT_STACK.replace(/"/g, "'");
  const html = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;position:relative;font-family:${font};">
  ${backdrop(c?.imageArtCrop ?? c?.imageNormal ?? null)}
  <div style="position:absolute;top:210px;width:100%;text-align:center;">
    <span style="background:#fff;color:#1F1D18;font-size:44px;font-weight:800;letter-spacing:4px;padding:12px 28px;border-radius:999px;">NEW POST</span>
  </div>
  <img src="${toDataUri(coverFile)}" style="position:absolute;left:50%;top:52%;transform:translate(-50%,-50%) rotate(-2deg);
    width:800px;height:1000px;object-fit:cover;border-radius:28px;border:10px solid #fff;box-shadow:0 40px 100px rgba(0,0,0,0.6);">
  <div style="position:absolute;bottom:170px;width:100%;text-align:center;color:#fff;font-size:40px;font-weight:700;">
    Full deck tech on the profile
  </div>
  <div style="position:absolute;bottom:110px;width:100%;text-align:center;color:rgba(255,255,255,0.75);font-size:34px;font-weight:600;">@floating.mana</div>
</body></html>`;
  const [frame] = await renderFrames([html], jobDir);
  const out = path.join(jobDir, "story-new-post.jpg");
  fs.renameSync(frame, out);
  return out;
}
