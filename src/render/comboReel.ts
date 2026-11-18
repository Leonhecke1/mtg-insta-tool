import * as fs from "fs";
import * as path from "path";

import puppeteer, { Browser } from "puppeteer";
import { config } from "../config";
import { spawnFfmpeg } from "./procs";
import { Combo } from "../combos/spellbook";
import { escapeHtml } from "./components";
import { FONT_STACK, MANA_CIRCLE_COLORS } from "./theme";
import { ColorCode } from "../types";
import { manaToWords, reelCoverPath, speakable, synthesizeVoice } from "./reel";
import { humanize } from "../skills/human";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string | null = require("ffmpeg-static");

/**
 * Combo-Reel im Stil von "Janky Combos": eine Karte gross im Bild, Kapitel-Chip
 * oben ("HOW IT WORKS"), der entscheidende Kartentext hervorgehoben und grosse
 * gelbe Untertitel Wort fuer Wort in der Bildmitte. Daten von Commander Spellbook.
 *
 *   Hook -> je Karte "PIECE i/n" -> THE LOOP (Schritte + Zaehler) -> RESULT -> Preis -> Frage
 */

const W = 1080;
const H = 1920;
const FPS = 30;
const FONT = FONT_STACK.replace(/"/g, "'");

type Kind = "hook" | "piece" | "step" | "result" | "price" | "cta";
interface Beat {
  kind: Kind;
  base: number;
  say: string;
  card?: number; // Index der gezeigten Karte (piece/step)
  step?: number; // Index bei "step"
  text?: string; // Bildtext (kurz)
}

/** Text auf hoechstens max Zeichen kuerzen, bevorzugt an Satzzeichen */
function trimClause(s: string, max: number): string {
  const t = s.trim().replace(/\.$/, "");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = Math.max(cut.lastIndexOf(", "), cut.lastIndexOf("; "), cut.lastIndexOf(": "));
  return (at > max * 0.45 ? cut.slice(0, at) : cut.replace(/\s+\S*$/, "")).trim();
}
interface TimedBeat extends Beat {
  start: number;
  dur: number;
  voiceSec: number;
}

const NUM = ["zero", "One", "Two", "Three", "Four", "Five"];

/** Kurze, sprechbare Fassung eines Ergebnisses ("Infinite colorless mana") */
function resultShort(c: Combo): string {
  const r = c.results[0] ?? "something wild";
  return r.length > 60 ? r.slice(0, 57).replace(/\s+\S*$/, "") + "…" : r;
}

export function comboScript(c: Combo): { beats: Beat[]; hookScreen: string } {
  const n = c.cards.length;
  const res = resultShort(c).replace(/…$/, "");
  const infinite = /^infinite/i.test(res);
  const lower = res.charAt(0).toLowerCase() + res.slice(1);
  const shorten = (s: string) => c.cards.reduce((t, card) => t.split(card.name).join(card.shortName), s);

  const beats: Beat[] = [
    {
      kind: "hook",
      base: 2.6,
      say: infinite ? `${NUM[n] ?? n} cards. ${res}. Here's how.` : `${NUM[n] ?? n} cards that ${trimClause(lower, 70)}. Here's how.`,
    },
  ];
  // Jede Karte: nur der entscheidende Satz, kurz
  c.cards.forEach((card, i) => {
    const key = trimClause(card.keyText ?? "", 95);
    beats.push({
      kind: "piece",
      card: i,
      base: 3,
      say: `${card.shortName}${key ? `: ${key}.` : "."}`,
      text: key,
    });
  });
  // Der Loop: ein Schritt pro Szene (max. 4), "Repeat" wird zum Unendlich-Moment
  const steps = c.steps.slice(0, 5).filter((s) => !/^repeat\.?$/i.test(s.trim())).slice(0, 4);
  steps.forEach((s, i) => {
    const short = trimClause(shorten(s), 90);
    const cardIdx = c.cards.findIndex((k) => s.includes(k.name) || s.includes(k.shortName));
    beats.push({ kind: "step", step: i, card: cardIdx >= 0 ? cardIdx : undefined, base: 2.8, say: `${short}.`, text: short });
  });
  beats.push({
    kind: "result",
    base: 3,
    say: `${c.steps.some((s) => /^repeat/i.test(s.trim())) ? "Repeat, and " : "And "}${lower.length > 90 ? trimClause(lower, 90) : lower}.${
      c.prerequisites[0] ? ` You just need ${trimClause(c.prerequisites[0].charAt(0).toLowerCase() + c.prerequisites[0].slice(1), 70)}.` : ""
    }`,
  });
  if (c.priceEur != null) {
    beats.push({ kind: "price", base: 2.2, say: `The whole combo: about ${c.priceEur < 1 ? `${Math.round(c.priceEur * 100)} cents` : `${Math.round(c.priceEur)} euros`}.` });
  }
  beats.push({ kind: "cta", base: 2.6, say: "Would you run this? Tell me in the comments." });

  // Bild-Hook: max. ~6 Woerter
  const words = res.split(/\s+/);
  const hookScreen = infinite ? `${n} cards. ${words.slice(0, 4).join(" ")}` : `${n} cards. ${words.slice(0, 4).join(" ")}…`;
  return { beats, hookScreen };
}

function sceneHtml(b: TimedBeat, c: Combo, hookScreen: string): string {
  const attrs = `class="beat" data-start="${b.start}" data-dur="${b.dur}"`;
  const card = (url: string | undefined, cls: string, extra = "") => (url ? `<img class="card ${cls}" src="${escapeHtml(url)}" ${extra} alt="">` : "");
  switch (b.kind) {
    case "hook": {
      const n = c.cards.length;
      const rot = n === 2 ? [-8, 8] : [-12, 0, 12];
      const dx = n === 2 ? [-150, 150] : [-230, 0, 230];
      return `<section ${attrs}>
        <div class="chip anim" data-d="0" data-y="-30">COMBO</div>
        <h1 class="big anim" data-d="0.05" data-y="50">${escapeHtml(hookScreen)}</h1>
        <div class="fan">${c.cards
          .map((k, i) => `<div class="fanc anim" data-d="${0.2 + i * 0.2}" data-y="400" style="--x:${dx[i] ?? 0}px;--r:${rot[i] ?? 0}deg">${card(k.image, "mid")}</div>`)
          .join("")}</div>
      </section>`;
    }
    case "piece": {
      const k = c.cards[b.card!];
      return `<section ${attrs}>
        <div class="chip anim" data-d="0" data-y="-30">HOW IT WORKS · ${b.card! + 1}/${c.cards.length}</div>
        <div class="center anim" data-d="0.05" data-s="0.9" data-y="60">${card(k.image, "hero")}</div>
        ${b.text ? `<div class="key anim" data-d="0.6" data-y="30">${escapeHtml(manaToWords(b.text))}</div>` : ""}
      </section>`;
    }
    case "step": {
      const k = b.card != null ? c.cards[b.card] : undefined;
      return `<section ${attrs}>
        <div class="chip anim" data-d="0" data-y="-30">THE LOOP · STEP ${b.step! + 1}</div>
        ${k?.image ? `<div class="center anim" data-d="0.05" data-s="0.92" data-x="${b.step! % 2 ? 160 : -160}">${card(k.image, "step")}</div>` : ""}
        <div class="key anim" data-d="0.3" data-y="30">${escapeHtml(manaToWords(b.text ?? ""))}</div>
      </section>`;
    }
    case "result":
      return `<section ${attrs}>
        <div class="chip anim" data-d="0" data-y="-30">RESULT</div>
        <div class="inf anim" data-d="0" data-s="0.4" data-loop="1">×1</div>
        <div class="res anim" data-d="0.1" data-s="0.8">${c.results.slice(0, 3).map((r) => `<div>${escapeHtml(r)}</div>`).join("")}</div>
        ${c.prerequisites[0] ? `<div class="need anim" data-d="0.6" data-y="30"><b>You need:</b> ${escapeHtml(c.prerequisites[0])}</div>` : ""}
      </section>`;
    case "price":
      return `<section ${attrs}>
        <div class="chip anim" data-d="0" data-y="-30">THE WHOLE COMBO</div>
        <div class="price anim" data-d="0.05" data-s="0.7">€<span data-count="${Math.round((c.priceEur ?? 0) * 100)}" data-cents="1">0</span></div>
        <div class="sub anim" data-d="0.4" data-y="30">${c.cards.length} cards · Cardmarket</div>
      </section>`;
    case "cta":
      return `<section ${attrs}>
        <div class="fan small">${c.cards.map((k, i) => `<div class="fanc anim" data-d="${i * 0.1}" data-s="0.7" style="--x:${(i - (c.cards.length - 1) / 2) * 200}px;--r:${(i - (c.cards.length - 1) / 2) * 7}deg">${card(k.image, "small")}</div>`).join("")}</div>
        <h1 class="big anim" data-d="0.2" data-y="40" style="top:900px">Would you run this?</h1>
        <div class="pill anim" data-d="0.45" data-y="30">Tell me in the comments</div>
        <div class="sub anim" data-d="0.6" data-y="20" style="top:1190px">Full combo in the first comment</div>
      </section>`;
  }
}

function pageHtml(c: Combo, beats: TimedBeat[], total: number, hookScreen: string): string {
  const colors = c.identity.split("").filter((x) => "WUBRG".includes(x)) as ColorCode[];
  const accent = colors.length ? MANA_CIRCLE_COLORS[colors[0]] : "#F8E7B9";
  const bg = c.cards[0]?.art ?? c.cards[0]?.image ?? "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #111; color: #fff; font-family: ${FONT}; }
  #bg { position: absolute; inset: -120px; background: url('${escapeHtml(bg)}') center/cover; filter: blur(50px) saturate(1.3) brightness(.5); }
  #shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10,10,12,.5), rgba(10,10,12,.15) 40%, rgba(10,10,12,.75)); }
  /* Sichere Zone wie bei den Deck-Reels */
  #stage { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; transform-origin: 50% 0; transform: translateY(122px) scale(0.85); }
  .beat { position: absolute; inset: 0; opacity: 0; }
  .anim { will-change: transform, opacity; }
  .chip { position: absolute; top: 130px; left: 50%; transform: translateX(-50%); white-space: nowrap; font-size: 40px; font-weight: 900; letter-spacing: 3px;
          padding: 12px 30px; border-radius: 16px; background: rgba(0,0,0,.6); border: 4px solid ${accent}; color: #fff; }
  .chip.anim { left: 0; right: 0; margin: 0 auto; width: fit-content; transform: none; }
  .big { position: absolute; left: 60px; right: 60px; top: 250px; margin: 0; text-align: center; font-size: 92px; line-height: 1.05; font-weight: 900; text-shadow: 0 8px 40px rgba(0,0,0,.7); }
  .card { display: block; border-radius: 4.6% / 3.4%; box-shadow: 0 50px 120px rgba(0,0,0,.65); }
  .card.hero { width: 700px; }
  .card.step { width: 600px; }
  .card.mid { width: 400px; }
  .card.small { width: 300px; }
  .center { position: absolute; left: 0; right: 0; top: 230px; display: flex; justify-content: center; }
  .key { position: absolute; left: 80px; right: 80px; top: 1060px; font-size: 40px; line-height: 1.3; font-weight: 700; color: #1F1D18;
         background: ${accent}; padding: 20px 28px; border-radius: 20px; box-shadow: 0 20px 50px rgba(0,0,0,.5); }
  .fan { position: absolute; left: 0; right: 0; top: 620px; height: 700px; }
  .fan.small { top: 330px; }
  .fanc { position: absolute; left: 50%; top: 0; margin-left: -200px; }
  .fan.small .fanc { margin-left: -150px; }
  .steps { position: absolute; left: 60px; right: 60px; top: 250px; display: grid; gap: 18px; }
  .step { display: flex; align-items: center; gap: 18px; background: rgba(0,0,0,.55); border-radius: 22px; padding: 16px 20px; border: 2px solid rgba(255,255,255,.12); }
  .step .no { flex: none; width: 70px; height: 70px; border-radius: 50%; background: ${accent}; color: #1F1D18; font-size: 40px; font-weight: 900; display: flex; align-items: center; justify-content: center; }
  .step img { flex: none; width: 90px; border-radius: 6px; }
  .step .tx { font-size: 32px; line-height: 1.25; font-weight: 600; }
  .inf { position: absolute; left: 0; right: 0; top: 200px; text-align: center; font-size: 150px; font-weight: 900; color: #FFD84A; -webkit-text-stroke: 4px #000; paint-order: stroke fill; }
  .counter { position: absolute; right: 70px; top: 120px; font-size: 64px; font-weight: 900; color: ${accent}; text-shadow: 0 6px 30px rgba(0,0,0,.7); }
  .res { position: absolute; left: 70px; right: 70px; top: 420px; display: grid; gap: 24px; text-align: center; }
  .res div { font-size: 66px; line-height: 1.1; font-weight: 900; text-shadow: 0 8px 40px rgba(0,0,0,.7); }
  .res div:first-child { color: ${accent}; font-size: 80px; }
  .need { position: absolute; left: 90px; right: 90px; top: 1000px; font-size: 38px; line-height: 1.3; text-align: center; background: rgba(0,0,0,.5); padding: 20px 28px; border-radius: 20px; }
  .price { position: absolute; left: 0; right: 0; top: 520px; text-align: center; font-size: 230px; font-weight: 900; color: ${accent}; font-variant-numeric: tabular-nums; text-shadow: 0 10px 60px rgba(0,0,0,.6); }
  .sub { position: absolute; left: 0; right: 0; top: 820px; text-align: center; font-size: 42px; font-weight: 600; color: rgba(255,255,255,.85); }
  .pill { position: absolute; left: 0; right: 0; top: 1060px; margin: 0 auto; width: fit-content; font-size: 50px; font-weight: 900; color: #1F1D18; background: ${accent}; padding: 20px 40px; border-radius: 999px; }
  /* Grosse gelbe Untertitel Wort fuer Wort (wie im Vorbild) */
  #cap { position: absolute; left: 50px; right: 50px; top: 1330px; text-align: center; font-size: 78px; line-height: 1.1; font-weight: 900; color: #FFD84A;
         -webkit-text-stroke: 3px #000; paint-order: stroke fill; text-shadow: 0 6px 0 #000, 0 0 30px rgba(0,0,0,.8); }
</style></head><body>
  <div id="bg"></div><div id="shade"></div>
  <div id="stage">
    ${beats.map((b) => sceneHtml(b, c, hookScreen)).join("\n")}
    <div id="cap"></div>
  </div>
<script>
  const TOTAL = ${total};
  const BEATS = ${JSON.stringify(beats.map((b) => ({ start: b.start, dur: b.dur, cap: manaToWords(b.say), voice: b.voiceSec })))};
  // Untertitel: 2-4 Woerter pro Stueck, ueber die Sprechdauer verteilt
  BEATS.forEach((b) => {
    const words = b.cap.split(/\\s+/).filter(Boolean), chunks = [];
    let cur = [];
    for (const w of words) { cur.push(w); if (cur.join(" ").length >= 14 || /[.,:;!?]$/.test(w)) { chunks.push(cur.join(" ")); cur = []; } }
    if (cur.length) chunks.push(cur.join(" "));
    const span = (b.voice || b.dur - 0.3), total = chunks.reduce((n, c) => n + c.length + 2, 0);
    let at = b.start + 0.1;
    b.chunks = chunks.map((c) => { const s = at; at += span * ((c.length + 2) / total); return { from: s, text: c }; });
  });
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeOutBack = (t) => { const c = 1.4; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const sections = [...document.querySelectorAll(".beat")];
  const cap = document.getElementById("cap");
  const bg = document.getElementById("bg");
  window.renderAt = (t) => {
    bg.style.transform = "scale(" + (1.15 - 0.1 * t / TOTAL) + ")";
    sections.forEach((sec, i) => {
      const start = +sec.dataset.start, dur = +sec.dataset.dur, lt = t - start;
      const fadeIn = i === 0 ? 1 : clamp(lt / 0.2), fadeOut = clamp((start + dur - t) / 0.2);
      const visible = lt >= 0 && lt <= dur;
      sec.style.opacity = visible ? String(Math.min(fadeIn, i === sections.length - 1 ? 1 : fadeOut)) : "0";
      if (!visible) return;
      sec.querySelectorAll(".anim").forEach((el) => {
        const d = +(el.dataset.d || 0), p = clamp((lt - d) / 0.5);
        const e = easeOutBack(p), o = easeOut(clamp((lt - d) / 0.3));
        const x = (+el.dataset.x || 0) * (1 - e), y = (+el.dataset.y || 0) * (1 - e);
        const s0 = el.dataset.s ? +el.dataset.s : 1, sc = s0 + (1 - s0) * e;
        const fx = getComputedStyle(el).getPropertyValue("--x") || "0px";
        const fr = parseFloat(getComputedStyle(el).getPropertyValue("--r")) || 0;
        // langsamer Zoom auf die grosse Karte, damit das Bild nie stillsteht
        const zoom = el.classList.contains("center") ? 1 + 0.04 * clamp(lt / dur) : 1;
        el.style.opacity = String(o);
        el.style.transform = "translate(calc(" + fx + " + " + x + "px)," + y + "px) rotate(" + fr + "deg) scale(" + sc * zoom + ")";
      });
      sec.querySelectorAll("[data-count]").forEach((el) => {
        const v = +el.dataset.count * easeOut(clamp(lt / 0.9));
        el.textContent = el.dataset.cents ? (v / 100).toFixed(2) : String(Math.round(v));
      });
      // Loop-Zaehler: x1, x2, x3 ... dann unendlich
      sec.querySelectorAll("[data-loop]").forEach((el) => {
        const k = Math.floor(lt / 0.25) + 1;
        el.textContent = lt > 1.4 ? "×∞" : "×" + k;
      });
    });
    const cur = BEATS.find((b) => t >= b.start && t < b.start + b.dur) || BEATS[BEATS.length - 1];
    const chunk = [...cur.chunks].reverse().find((c) => t >= c.from);
    const txt = chunk ? chunk.text : "";
    if (cap.textContent !== txt) cap.textContent = txt;
  };
  window.assetsReady = () => Promise.all([...document.images].map((img) => img.complete ? Promise.resolve() : new Promise((r) => { img.onload = img.onerror = r; })));
</script></body></html>`;
}

export async function buildComboReel(
  c: Combo,
  onProgress: (step: string, p?: number) => void = () => undefined
): Promise<{ video: string; cover: string | null }> {
  if (!ffmpegPath) throw new Error("ffmpeg-static binary not available on this platform");
  const dir = path.join(config.outDir, "combos", c.id.replace(/[^\w-]/g, "_"));
  fs.mkdirSync(dir, { recursive: true });
  const { beats: script, hookScreen } = comboScript(c);

  const voices: ({ file: string; seconds: number } | null)[] = [];
  for (let i = 0; i < script.length; i++) {
    onProgress(`Combo-Reel: Sprachaufnahme ${i + 1}/${script.length}`, (i / script.length) * 0.08);
    voices.push(await synthesizeVoice(speakable(script[i].say), dir, `voice-${i}.wav`));
  }
  // Ohne Stimme: Lesezeit fuer die Untertitel (~15 Zeichen pro Sekunde)
  let t = 0;
  const beats: TimedBeat[] = script.map((b, i) => {
    const v = voices[i];
    const read = b.say.length / 15 + 0.6;
    const dur = Math.max(b.base, v ? v.seconds + 0.4 : read);
    const tb = { ...b, start: t, dur, voiceSec: v ? v.seconds : read - 0.4 };
    t += dur;
    return tb;
  });
  const total = t;
  const frames = Math.round(total * FPS);

  const video = path.join(dir, "reel.mp4");
  const args = ["-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-"];
  const withVoice = voices.some(Boolean);
  if (withVoice) {
    const ins: { idx: number; ms: number }[] = [];
    voices.forEach((v, i) => {
      if (!v) return;
      args.push("-i", v.file);
      ins.push({ idx: ins.length + 1, ms: Math.round((beats[i].start + 0.1) * 1000) });
    });
    const parts = ins.map((a) => `[${a.idx}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${a.ms}|${a.ms}[a${a.idx}]`);
    args.push("-filter_complex", [...parts, `${ins.map((a) => `[a${a.idx}]`).join("")}amix=inputs=${ins.length}:normalize=0,apad,atrim=0:${total.toFixed(3)}[a]`].join(";"), "-map", "0:v", "-map", "[a]");
  } else {
    args.push("-f", "lavfi", "-t", total.toFixed(3), "-i", "anullsrc=r=44100:cl=stereo", "-map", "0:v", "-map", "1:a");
  }
  args.push("-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", String(FPS), "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", video);

  const { proc: ff, done } = spawnFfmpeg(ffmpegPath, args);

  let browser: Browser | null = null;
  const cover = reelCoverPath(video);
  try {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.setContent(pageHtml(c, beats, total, hookScreen), { waitUntil: "networkidle0", timeout: 90_000 });
    await page.evaluate("window.assetsReady()");
    const coverFrame = Math.min(frames - 1, Math.round(1.8 * FPS));
    for (let f = 0; f < frames; f++) {
      if (f % 15 === 0) onProgress(`Combo-Reel: Bild ${f + 1} von ${frames}`, 0.1 + 0.85 * (f / frames));
      await page.evaluate(`window.renderAt(${(f / FPS).toFixed(4)})`);
      const buf = (await page.screenshot({ type: "jpeg", quality: 90 })) as Buffer;
      if (f === coverFrame) fs.writeFileSync(cover, buf);
      if (!ff.stdin!.write(buf)) await new Promise((r) => ff.stdin!.once("drain", r));
    }
  } catch (e) {
    ff.kill("SIGKILL");
    throw e;
  } finally {
    ff.stdin!.end();
    if (browser) await browser.close();
  }
  onProgress("Combo-Reel: Video wird kodiert", 0.96);
  await done;
  voices.forEach((v) => v && fs.rmSync(v.file, { force: true }));
  return { video, cover: fs.existsSync(cover) ? cover : null };
}

const tag = (s: string) => "#" + s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");

/** Caption nach /ig-caption + /ig-human; Spellbook-Link kommt in den ersten Kommentar */
export function comboCaption(c: Combo): { caption: string; firstComment: string; keywords: string[] } {
  const names = c.cards.map((x) => x.shortName);
  const lines = [
    `${names.join(" + ")} = ${c.results[0] ?? "a combo"}.`,
    c.steps.slice(0, 3).map((s) => c.cards.reduce((t, x) => t.split(x.name).join(x.shortName), s)).join(" "),
    c.prerequisites[0] ? `You need: ${c.prerequisites[0]}` : "",
    c.priceEur != null ? `The whole combo is about €${c.priceEur.toFixed(2)} on Cardmarket.` : "",
    "Would you run this? Tell me in the comments.",
    ["#edh", "#mtgcombo", "#mtgcommander", tag(names[0] ?? "")].filter((x) => x.length > 1).join(" "),
  ];
  const caption = humanize(lines.filter(Boolean).join("\n\n"), [...c.cards.map((x) => x.name), ...names]).text;
  return { caption, firstComment: `Full combo: ${c.url}`, keywords: [...names, "combo"] };
}
