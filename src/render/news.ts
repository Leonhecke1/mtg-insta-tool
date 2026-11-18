import * as fs from "fs";
import * as path from "path";
import puppeteer, { Browser } from "puppeteer";
import { config } from "../config";
import { NewsItem } from "../news/news";
import { escapeHtml } from "./components";
import { FONT_STACK, MANA_CIRCLE_COLORS, colorComboName } from "./theme";
import { ColorCode } from "../types";
import { humanize } from "../skills/human";
import { lintCaption } from "../skills/caption";

/**
 * News-Grafik: Kartenbild gross auf geblurrtem Artwork, Label oben
 * ("NEW COMMANDER", "BANNED IN COMMANDER" ...), Name, Set und Datum.
 * Gleicher Look wie die Reels. Feed = 1080x1350, Story = 1080x1920.
 */

const LABEL: Record<string, string> = {
  commander: "NEW COMMANDER",
  ban: "BANNED IN COMMANDER",
  unban: "UNBANNED IN COMMANDER",
  gamechanger: "NEW GAME CHANGER",
  gamechanger_removed: "NO LONGER A GAME CHANGER",
  article: "MTG NEWS",
};

function fmtDate(iso?: string): string {
  if (!iso) return "";
  return new Date(iso + (iso.length === 10 ? "T12:00:00" : "")).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export async function renderNewsGraphic(item: NewsItem, format: "post" | "story"): Promise<string> {
  const W = 1080;
  const H = format === "story" ? 1920 : 1350;
  const font = FONT_STACK.replace(/"/g, "'");
  const colors = (item.colors ?? []) as ColorCode[];
  const accent = colors.length ? MANA_CIRCLE_COLORS[colors[0]] : "#F8E7B9";
  const upcoming = item.releasedAt && item.releasedAt > new Date().toISOString().slice(0, 10);
  const sub = [item.setName, item.releasedAt ? `${upcoming ? "out" : "released"} ${fmtDate(item.releasedAt)}` : ""].filter(Boolean).join(" · ");
  const name = item.cardName ?? item.title;
  const cardW = format === "story" ? 640 : 520;
  // Story: Inhalte in Instagrams sicherer Zone (oben/unten frei)
  const top = format === "story" ? 260 : 90;

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; position: relative; background: #111; color: #fff; font-family: ${font}; }
    #bg { position: absolute; inset: -80px; background: url('${escapeHtml(item.art ?? item.image ?? "")}') center/cover; filter: blur(42px) saturate(1.2) brightness(.5); }
    #shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10,10,12,.55), rgba(10,10,12,.2) 40%, rgba(10,10,12,.8)); }
    .stack { position: absolute; left: 70px; right: 70px; top: ${top}px; display: flex; flex-direction: column; align-items: center; gap: 22px; text-align: center; }
    .chip { font-size: 32px; font-weight: 900; letter-spacing: 5px; padding: 12px 28px; border-radius: 999px; background: ${accent}; color: #1F1D18; }
    h1 { margin: 0; font-size: ${name.length > 28 ? 64 : 80}px; line-height: 1.05; font-weight: 900; letter-spacing: -1.5px; text-shadow: 0 8px 40px rgba(0,0,0,.6); }
    .sub { font-size: 34px; font-weight: 600; color: rgba(255,255,255,.85); }
    img { width: ${cardW}px; border-radius: 4.6% / 3.4%; box-shadow: 0 50px 120px rgba(0,0,0,.65); margin-top: 10px; }
    .handle { position: absolute; bottom: ${format === "story" ? 330 : 40}px; width: 100%; text-align: center; font-size: 30px; font-weight: 700; color: rgba(255,255,255,.6); }
  </style></head><body>
    <div id="bg"></div><div id="shade"></div>
    <div class="stack">
      <div class="chip">${escapeHtml(LABEL[item.type] ?? "MTG NEWS")}</div>
      <h1>${escapeHtml(name.split(" // ")[0])}</h1>
      ${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ""}
      ${item.image ? `<img src="${escapeHtml(item.image)}" alt="">` : ""}
    </div>
    <div class="handle">@floating.mana</div>
  </body></html>`;

  const dir = path.join(config.outDir, "news");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${item.id}-${format}.jpg`);
  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 60_000 });
    await page.screenshot({ path: out as `${string}.jpeg`, type: "jpeg", quality: 92 });
  } finally {
    if (browser) await browser.close();
  }
  return out;
}

/**
 * Spoiler-Carousel: 1. Slide = Spoiler-Warnung als Cover, danach die Karten.
 * Bis 9 Karten je eine Karte pro Slide, sonst 4 pro Slide (max. 10 Slides).
 */
export async function renderSpoilerCarousel(item: NewsItem): Promise<string[]> {
  const W = 1080;
  const H = 1350;
  const font = FONT_STACK.replace(/"/g, "'");
  const cards = (item.cards ?? []).filter((c) => c.image);
  const accent = item.colors?.length ? MANA_CIRCLE_COLORS[item.colors[0] as ColorCode] : "#F8E7B9";
  const upcoming = item.releasedAt && item.releasedAt > new Date().toISOString().slice(0, 10);
  const perSlide = cards.length <= 9 ? 1 : 4;
  const groups: (typeof cards)[] = [];
  for (let i = 0; i < cards.length && groups.length < 9; i += perSlide) groups.push(cards.slice(i, i + perSlide));
  const shown = groups.flat().length;

  const base = (body: string, bg?: string) => `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; position: relative; background: #111; color: #fff; font-family: ${font}; }
    #bg { position: absolute; inset: -80px; background: url('${escapeHtml(bg ?? "")}') center/cover; filter: blur(46px) saturate(1.2) brightness(.45); }
    #shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10,10,12,.5), rgba(10,10,12,.25) 45%, rgba(10,10,12,.8)); }
    .c { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 26px; text-align: center; padding: 70px; }
    .warn { font-size: 40px; font-weight: 900; letter-spacing: 8px; padding: 16px 34px; border-radius: 999px; background: #E2463A; color: #fff; }
    h1 { margin: 0; font-size: 104px; line-height: 1; font-weight: 900; letter-spacing: -2px; text-shadow: 0 8px 40px rgba(0,0,0,.6); }
    .sub { font-size: 40px; font-weight: 700; color: ${accent}; }
    .small { font-size: 32px; color: rgba(255,255,255,.8); max-width: 820px; line-height: 1.35; }
    .swipe { margin-top: 20px; font-size: 38px; font-weight: 800; padding: 16px 32px; border: 3px solid rgba(255,255,255,.5); border-radius: 999px; }
    .one img { width: 700px; border-radius: 4.6% / 3.4%; box-shadow: 0 50px 120px rgba(0,0,0,.65); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; }
    .grid img { width: 400px; border-radius: 4.6% / 3.4%; box-shadow: 0 30px 70px rgba(0,0,0,.6); }
    .name { font-size: 40px; font-weight: 800; text-shadow: 0 4px 20px rgba(0,0,0,.7); }
    .count { position: absolute; top: 50px; right: 60px; font-size: 28px; font-weight: 700; color: rgba(255,255,255,.7); }
    .handle { position: absolute; bottom: 40px; width: 100%; text-align: center; font-size: 28px; font-weight: 700; color: rgba(255,255,255,.55); }
  </style></head><body><div id="bg"></div><div id="shade"></div>${body}<div class="handle">@floating.mana</div></body></html>`;

  const pages: string[] = [
    // Cover mit Spoiler-Warnung: die Karten selbst sind erst nach dem Wischen zu sehen
    base(
      `<div class="c">
        <div class="warn">⚠ SPOILER</div>
        <h1>${shown} new card${shown === 1 ? "" : "s"}</h1>
        <div class="sub">${escapeHtml(item.setName ?? "")}${item.releasedAt ? ` · ${upcoming ? "out" : "released"} ${escapeHtml(fmtDate(item.releasedAt))}` : ""}</div>
        <div class="small">Officially revealed cards. Don't want spoilers? Keep scrolling.</div>
        <div class="swipe">Swipe to see them →</div>
      </div>`,
      item.art
    ),
    ...groups.map((g, i) =>
      base(
        g.length === 1
          ? `<div class="count">${i + 1} / ${groups.length}</div><div class="c one"><img src="${escapeHtml(g[0].image!)}" alt=""><div class="name">${escapeHtml(g[0].name.split(" // ")[0])}</div></div>`
          : `<div class="count">${i + 1} / ${groups.length}</div><div class="c"><div class="grid">${g.map((c) => `<img src="${escapeHtml(c.image!)}" alt="">`).join("")}</div></div>`,
        g[0].art
      )
    ),
  ];

  const dir = path.join(config.outDir, "news", item.id);
  fs.mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    for (const [i, html] of pages.entries()) {
      await page.setContent(html, { waitUntil: "networkidle0", timeout: 60_000 });
      const out = path.join(dir, `slide-${String(i + 1).padStart(2, "0")}.jpg`);
      await page.screenshot({ path: out as `${string}.jpeg`, type: "jpeg", quality: 92 });
      files.push(out);
    }
  } finally {
    if (browser) await browser.close();
  }
  return files;
}

const tag = (s: string) => "#" + s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");

/** Caption nach /ig-caption + /ig-human: Hook, Fakten, eine Frage, max. 5 Hashtags */
export function newsCaption(item: NewsItem): { caption: string; firstComment?: string; keywords: string[] } {
  const name = (item.cardName ?? item.title).split(" // ")[0];
  const firstAbility = (item.body ?? "").split("\n").find((l) => l.trim().length > 20)?.trim();
  const colors = item.colors?.length ? colorComboName(item.colors as ColorCode[]) : "";
  const upcoming = item.releasedAt && item.releasedAt > new Date().toISOString().slice(0, 10);
  let lines: string[];
  switch (item.type) {
    case "spoiler": {
      const n = item.cards?.length ?? 0;
      const names = (item.cards ?? []).slice(0, 3).map((c) => c.name.split(" // ")[0]);
      lines = [
        `Spoiler: ${n} new card${n === 1 ? "" : "s"} from ${item.setName} just got revealed.`,
        names.length ? `Including ${names.join(", ")}${n > 3 ? " and more" : ""}.` : "",
        item.releasedAt ? `${upcoming ? "Out" : "Released"} ${fmtDate(item.releasedAt)}.` : "",
        "Which one would you put in a commander deck first? Tell me in the comments.",
        ["#mtg", "#mtgspoilers", "#edh", item.setName ? tag(item.setName) : ""].filter(Boolean).join(" "),
      ];
      // Karten- UND Set-Namen schuetzen ("Sunken Realm" darf nicht zu "Sunken World" werden)
      const caption = humanize(lines.filter(Boolean).join("\n\n"), [...(item.cards ?? []).map((c) => c.name), item.setName ?? ""]).text;
      return { caption, firstComment: item.url ? `All spoilers: ${item.url}` : undefined, keywords: [item.setName ?? "", "spoilers"] };
    }
    case "commander":
      lines = [
        `${name} is a new commander from ${item.setName}.`,
        firstAbility ? `${firstAbility}` : "",
        `${colors ? `${colors}. ` : ""}${item.releasedAt ? `${upcoming ? "Out" : "Released"} ${fmtDate(item.releasedAt)}.` : ""}`,
        "Would you build it? Tell me in the comments.",
        ["#mtg", "#edh", "#newcommander", item.setName ? tag(item.setName) : ""].filter(Boolean).join(" "),
      ];
      break;
    case "ban":
    case "unban":
      lines = [
        `${name} is ${item.type === "ban" ? "now banned" : "unbanned"} in Commander.`,
        firstAbility ? `${firstAbility}` : "",
        `${item.type === "ban" ? "Did you see this one coming?" : "Is it coming back into your decks?"} Tell me in the comments.`,
        "#mtg #edh #mtgcommander #banlist",
      ];
      break;
    case "gamechanger":
    case "gamechanger_removed":
      lines = [
        `${name} is ${item.type === "gamechanger" ? "now on" : "off"} the Game Changers list. That changes which bracket your deck lands in.`,
        firstAbility ?? "",
        "Good call or not? Tell me in the comments.",
        "#mtg #edh #mtgcommander #gamechangers",
      ];
      break;
    default:
      lines = item.cardName
        ? [
            item.title && item.title !== item.cardName ? `${item.title}: ${name}.` : `${name}${item.setName ? ` from ${item.setName}` : ""}.`,
            firstAbility ?? "",
            colors ? `${colors}.` : "",
            "Would this make it into your deck? Tell me in the comments.",
            ["#mtg", "#edh", "#mtgnews", item.setName ? tag(item.setName) : ""].filter(Boolean).join(" "),
          ]
        : [item.title, "What do you think? Tell me in the comments.", "#mtg #edh #mtgnews"];
  }
  const caption = humanize(lines.filter(Boolean).join("\n\n"), [item.cardName ?? "", name, item.setName ?? "", item.title]).text;
  return { caption, firstComment: item.url ? `Source: ${item.url}` : undefined, keywords: [name, "commander"] };
}

export { lintCaption };
