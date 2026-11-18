import * as fs from "fs";
import * as path from "path";

import puppeteer, { Browser } from "puppeteer";
import { config } from "../config";
import { spawnFfmpeg } from "./procs";
import { Combo } from "../combos/spellbook";
import { escapeHtml } from "./components";
import { FONT_STACK, MANA_CIRCLE_COLORS } from "./theme";
import { ColorCode } from "../types";
import { manaToWords, reelCoverPath, speakable, synthesizeVoices } from "./reel";
import { humanize } from "../skills/human";
import { buildSoundtrack, Cue } from "./sound";
import { activatedEffect, asWhichClause, asYouClause, end, lcFirst, startsWithVerb } from "../skills/narration";
import { audioArgs, LAND, STYLE_HTML, STYLE_JS, styleCss } from "./reelStyle";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string | null = require("ffmpeg-static");

/**
 * Combo-Reel im Stil von "Janky Combos": eine Karte gross im Bild, Kapitel-Chip
 * oben ("HOW IT WORKS"), der entscheidende Kartentext hervorgehoben und grosse
 * gelbe Untertitel Wort fuer Wort in der Bildmitte. Daten von Commander Spellbook.
 *
 *   Hook -> je Karte "PIECE i/n" -> THE LOOP (Schritte + Zaehler) -> RESULT -> Preis -> Frage
 *
 * Schnitt und Look nach dem /stick-figure-Skill aus
 * github.com/artemnovitckii/claude-animation-skills (MIT): Wischuebergaenge mit
 * Bewegungsunschaerfe, Handkamera-Drift + langsamer Push-in, Aufprall = Burst,
 * Wackeln und Blitz, Vignette + Koernung, Untertitel mit 1-2 Woertern
 * (klein, ohne Satzzeichen), Soundeffekte und Musik im Code erzeugt (sound.ts).
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
  // am liebsten an einem Satzende kuerzen
  const dot = cut.lastIndexOf(". ");
  if (dot > max * 0.4) return cut.slice(0, dot).trim();
  const at =Math.max(cut.lastIndexOf(", "), cut.lastIndexOf("; "), cut.lastIndexOf(": "));
  let out = (at > max * 0.45 ? cut.slice(0, at) : cut.replace(/\s+\S*$/, "")).trim();
  // nicht mit "... with a" enden
  while (/\s(a|an|the|with|for|of|to|and|or|from|into|onto|your|that|you|it|by|in|on|at|as|is|are|its|their|then|if)$/i.test(out)) out = out.replace(/\s+\S+$/, "");
  return out;
}
interface TimedBeat extends Beat {
  start: number;
  dur: number;
  voiceSec: number;
}

const NUM = ["zero", "One", "Two", "Three", "Four", "Five"];

// Zeitpunkte innerhalb der Szenen (Bild und Ton nutzen dieselben Werte)
const INF_AT = 1.4; // Ergebnis: Zaehler springt auf unendlich
const FAN_AT = 0.1; // Hook: erste Karte fliegt ein
const FAN_STEP = 0.15;

/** Ton-Cues und Aufprall-Momente aus der Zeitachse */
function soundCues(beats: TimedBeat[], ncards: number): { cues: Cue[]; impacts: [number, number][]; resolveAt: number } {
  const cues: Cue[] = [];
  const impacts: [number, number][] = [];
  let resolveAt = beats[beats.length - 1].start;
  beats.forEach((b, i) => {
    if (i > 0) cues.push({ at: b.start - 0.22, kind: "whoosh" }); // Wischuebergang
    switch (b.kind) {
      case "hook":
        for (let k = 0; k < ncards; k++) cues.push({ at: b.start + Math.max(0.05, FAN_AT + k * FAN_STEP + LAND - 0.35), kind: "pop", gain: 0.8 + 0.1 * k });
        cues.push({ at: b.start + 0.05, kind: "sparkle", gain: 0.6 });
        break;
      case "piece":
        cues.push({ at: b.start + 0.05 + LAND, kind: "thud" });
        impacts.push([b.start + 0.05 + LAND, 0.25]);
        break;
      case "step":
        cues.push({ at: b.start + 0.05 + LAND, kind: "pop", gain: 0.6 });
        break;
      case "result": {
        // Riser in den Ergebnis-Moment, Ticks beim Hochzaehlen, dann Aufprall
        const hit = b.start + INF_AT;
        cues.push({ at: hit - 1.6, kind: "riser", dur: 1.6 });
        for (let at = 0; at < INF_AT; at += 0.25) cues.push({ at: b.start + at, kind: "tick" });
        cues.push({ at: hit, kind: "impact" }, { at: hit + 0.05, kind: "sparkle" });
        impacts.push([hit, 1]);
        resolveAt = hit;
        break;
      }
      case "price":
        for (let at = 0; at < 0.9; at += 0.07) cues.push({ at: b.start + at, kind: "tick", gain: 0.6 });
        cues.push({ at: b.start + 0.9, kind: "chime" });
        break;
      case "cta":
        cues.push({ at: b.start + 0.3, kind: "sparkle", gain: 0.7 });
        break;
    }
  });
  return { cues, impacts, resolveAt };
}

/** Kurze, sprechbare Fassung eines Ergebnisses ("Infinite colorless mana") */
function resultShort(c: Combo): string {
  const r = c.results[0] ?? "something wild";
  return r.length > 60 ? r.slice(0, 57).replace(/\s+\S*$/, "") + "…" : r;
}

/**
 * Combo-Schritt zum Vorlesen: vollstaendig (der Text steht nicht mehr in einer Box),
 * nur sehr lange Schritte am ersten Satzende kuerzen. Nie mitten im Satz abbrechen.
 */
function spokenStep(s: string): string {
  const t = s.trim().replace(/\.$/, "");
  if (t.length <= 180) return t;
  const dot = t.indexOf(". ");
  return dot > 30 ? t.slice(0, dot) : t;
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
      say: infinite
        ? `${NUM[n] ?? n} cards, and you get ${lower}. Let me show you how that works.`
        : `${NUM[n] ?? n} cards that ${trimClause(lower, 70)}. Let me show you how.`,
    },
  ];
  // Jede Karte: der entscheidende Satz, als Teil einer Erzaehlung ("First up, X, which ...")
  c.cards.forEach((card, i) => {
    const key = trimClause(card.keyText ?? "", 110);
    const intro = i === 0 ? "First up," : i === n - 1 ? "And then there's" : "Next up,";
    const which = key ? asWhichClause(key) : null;
    const act = activatedEffect((card.keyText ?? "").replace(/. If you do, /i, ", and if you do, "));
    const say = !key
      ? `${intro} ${card.shortName}.`
      : act
        ? // "{2}, {T}: You may copy ..." -> "When you activate it, you may copy ..."
          `${intro} ${card.shortName}. When you activate it, ${lcFirst(trimClause(act, 110))}.`
        : which
          ? `${intro} ${card.shortName}, ${which}.`
          : `${intro} ${card.shortName}. What matters here is that ${lcFirst(key)}.`;
    beats.push({
      kind: "piece",
      card: i,
      base: 3,
      say,
      text: key,
    });
  });
  // Der Loop: ein Schritt pro Szene (max. 3), "Repeat" wird zum Unendlich-Moment
  const steps = c.steps.slice(0, 5).filter((s) => !/^repeat\.?$/i.test(s.trim())).slice(0, 3);
  steps.forEach((s, i) => {
    const short = trimClause(shorten(s), 75);
    // die Karte, die im Schritt zuerst genannt wird ("Activate Isochron Scepter ... copy of Dramatic Reversal")
    let cardIdx = -1;
    let first = Infinity;
    c.cards.forEach((k, ki) => {
      const at = s.indexOf(k.shortName);
      if (at >= 0 && at < first) [first, cardIdx] = [at, ki];
    });
    const lead = ["So here's the loop. First,", "Then", "After that,"][i] ?? "Then";
    beats.push({ kind: "step", step: i, card: cardIdx >= 0 ? cardIdx : undefined, base: 2.8, say: end(`${lead} ${asYouClause(spokenStep(shorten(s)))}`), text: short });
  });
  beats.push({
    kind: "result",
    base: 3,
    say: (() => {
      const repeat = c.steps.some((s) => /^repeat/i.test(s.trim()));
      const r = lower.length > 90 ? trimClause(lower, 90) : lower;
      // Ergebnis als Befehl ("put all lands ...") vs. als Ding ("infinite mana")
      const res = startsWithVerb(r)
        ? `${repeat ? "Now just keep repeating that, and it lets you" : "And that lets you"} ${r}.`
        : `${repeat ? "Now just keep repeating that, and you end up with" : "And that leaves you with"} ${r}.`;
      const p = c.prerequisites[0];
      const need = p && p.length <= 60 ? (/^you\b/i.test(p) ? ` Just make sure ${lcFirst(trimClause(p, 70))}.` : ` All you need is ${lcFirst(trimClause(p, 70))}.`) : "";
      return res + need;
    })(),
  });
  if (c.priceEur != null) {
    beats.push({ kind: "price", base: 2.2, say: `And the best part? The whole combo costs about ${c.priceEur < 1 ? `${Math.round(c.priceEur * 100)} cents` : `${Math.round(c.priceEur)} euros`}.` });
  }
  beats.push({ kind: "cta", base: 2.6, say: "So, would you play this one? Tell me in the comments." });

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
          .map((k, i) => `<div class="fanc anim" data-d="${FAN_AT + i * FAN_STEP}" data-y="400" style="--x:${dx[i] ?? 0}px;--r:${rot[i] ?? 0}deg">${card(k.image, "mid")}</div>`)
          .join("")}</div>
      </section>`;
    }
    case "piece": {
      const k = c.cards[b.card!];
      return `<section ${attrs}>
        <div class="chip anim" data-d="0" data-y="-30">HOW IT WORKS · ${b.card! + 1}/${c.cards.length}</div>
        <div class="center anim" data-d="0.05" data-s="0.9" data-y="60">${card(k.image, "hero")}</div>
      </section>`;
    }
    case "step": {
      const k = b.card != null ? c.cards[b.card] : undefined;
      return `<section ${attrs}>
        <div class="chip anim" data-d="0" data-y="-30">THE LOOP · STEP ${b.step! + 1}</div>
        ${
          k?.image
            ? `<div class="center anim" data-d="0.05" data-s="0.92" data-x="${b.step! % 2 ? 160 : -160}">${card(k.image, "hero")}</div>`
            : // Schritt ohne erkennbare Karte: alle Karten im Faecher
              `<div class="fan" style="top:420px">${c.cards.map((x, i) => `<div class="fanc anim" data-d="${i * 0.1}" data-s="0.8" style="--x:${(i - (c.cards.length - 1) / 2) * 260}px;--r:${(i - (c.cards.length - 1) / 2) * 8}deg">${card(x.image, "mid")}</div>`).join("")}</div>`
        }
      </section>`;
    }
    case "result":
      return `<section ${attrs}>
        <div class="chip anim" data-d="0" data-y="-30">RESULT</div>
        <div class="burst" data-at="${INF_AT}"></div>
        <div class="inf anim" data-d="0" data-s="0.4" data-loop="1">×1</div>
        <div class="res anim" data-d="0.1" data-s="0.8">${c.results.slice(0, 3).map((r) => `<div>${escapeHtml(r)}</div>`).join("")}</div>
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

function pageHtml(c: Combo, beats: TimedBeat[], total: number, hookScreen: string, impacts: [number, number][]): string {
  const colors = c.identity.split("").filter((x) => "WUBRG".includes(x)) as ColorCode[];
  const accent = colors.length ? MANA_CIRCLE_COLORS[colors[0]] : "#F8E7B9";
  const bg = c.cards[0]?.art ?? c.cards[0]?.image ?? "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #111; color: #fff; font-family: ${FONT}; }
  #bg { position: absolute; inset: -120px; background: url('${escapeHtml(bg)}') center/cover; filter: blur(50px) saturate(1.3) brightness(.5); }
  #shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10,10,12,.5), rgba(10,10,12,.15) 40%, rgba(10,10,12,.75)); }
  ${styleCss(accent)}
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
  .fan { position: absolute; left: 0; right: 0; top: 620px; height: 700px; }
  .fan.small { top: 330px; }
  .fanc { position: absolute; left: 50%; top: 0; margin-left: -200px; }
  .fan.small .fanc { margin-left: -150px; }
  .inf { position: absolute; left: 0; right: 0; top: 200px; text-align: center; font-size: 150px; font-weight: 900; color: #FFD84A; -webkit-text-stroke: 4px #000; paint-order: stroke fill; }
  .counter { position: absolute; right: 70px; top: 120px; font-size: 64px; font-weight: 900; color: ${accent}; text-shadow: 0 6px 30px rgba(0,0,0,.7); }
  .res { position: absolute; left: 70px; right: 70px; top: 420px; display: grid; gap: 24px; text-align: center; }
  .res div { font-size: 66px; line-height: 1.1; font-weight: 900; text-shadow: 0 8px 40px rgba(0,0,0,.7); }
  .res div:first-child { color: ${accent}; font-size: 80px; }
  .price { position: absolute; left: 0; right: 0; top: 520px; text-align: center; font-size: 230px; font-weight: 900; color: ${accent}; font-variant-numeric: tabular-nums; text-shadow: 0 10px 60px rgba(0,0,0,.6); }
  .sub { position: absolute; left: 0; right: 0; top: 820px; text-align: center; font-size: 42px; font-weight: 600; color: rgba(255,255,255,.85); }
  .pill { position: absolute; left: 0; right: 0; top: 1060px; margin: 0 auto; width: fit-content; font-size: 50px; font-weight: 900; color: #1F1D18; background: ${accent}; padding: 20px 40px; border-radius: 999px; }
</style></head><body>
  <div id="bg"></div><div id="shade"></div>
  <div id="stage">
    ${beats.map((b) => sceneHtml(b, c, hookScreen)).join("\n")}
  </div>
  ${STYLE_HTML}
<script>
  const TOTAL = ${total};
  const BEATS = ${JSON.stringify(beats.map((b) => ({ start: b.start, dur: b.dur, cap: manaToWords(b.say), voice: b.voiceSec })))};
  // Aufprall-Momente: [Zeitpunkt, Staerke] -> Wackeln + Blitz
  const IMPACTS = ${JSON.stringify(impacts)};
  ${STYLE_JS}
  const bg = document.getElementById("bg");
  window.renderAt = (t) => {
    bg.style.transform = "scale(" + (1.15 - 0.1 * t / TOTAL) + ")";
    const shown = styleFrame(t, true);
    if (!shown) return;
    const { sec, i: si, lt: lt0, dur } = shown;
    const lt = si === 0 ? lt0 + 0.35 : lt0;
    {
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
        el.textContent = lt > ${INF_AT} ? "×∞" : "×" + k;
      });
    }
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

  const voices = await synthesizeVoices(
    script.map((b) => speakable(b.say)),
    dir,
    "voice-",
    (s, p) => onProgress(`Combo-Reel: ${s}`, p)
  );
  // Ohne Stimme: Lesezeit fuer die Untertitel (~15 Zeichen pro Sekunde)
  let t = 0;
  const beats: TimedBeat[] = script.map((b, i) => {
    const v = voices[i];
    const read = b.say.length / 17 + 0.5;
    const dur = Math.max(b.base, v ? v.seconds + 0.3 : read);
    const tb = { ...b, start: t, dur, voiceSec: v ? v.seconds : read - 0.4 };
    t += dur;
    return tb;
  });
  const total = t;
  const frames = Math.round(total * FPS);

  // Soundeffekte + Untermalung (im Code erzeugt), Musik wird unter der Stimme leiser
  const { cues, impacts, resolveAt } = soundCues(beats, c.cards.length);
  const sfxFile = path.join(dir, "sfx.wav");
  const musicFile = path.join(dir, "music.wav");
  buildSoundtrack(cues, total, resolveAt, sfxFile, musicFile);

  const video = path.join(dir, "reel.mp4");
  const spoken = voices.flatMap((v, i) => (v ? [{ file: v.file, at: beats[i].start + 0.1 }] : []));
  const args = ["-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", ...audioArgs(sfxFile, musicFile, spoken, total)];
  args.push("-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", String(FPS), "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", video);

  const { proc: ff, done } = spawnFfmpeg(ffmpegPath, args);

  let browser: Browser | null = null;
  const cover = reelCoverPath(video);
  try {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.setContent(pageHtml(c, beats, total, hookScreen, impacts), { waitUntil: "networkidle0", timeout: 90_000 });
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
  [sfxFile, musicFile].forEach((f) => fs.rmSync(f, { force: true }));
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
