import * as fs from "fs";
import * as path from "path";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import puppeteer, { Browser } from "puppeteer";
import { config } from "../config";
import { Deck } from "../types";
import { analyzeDeck, cardRole, DeckAnalysis, shortName } from "../llm/fallback";

const ENGINE_INTRO: Record<number, string> = { 1: "One card makes it work.", 2: "Two cards make it work.", 3: "Three cards make it work." };
import { applyPronunciation } from "../settings/pronunciation";
import { escapeHtml } from "./components";
import { FONT_STACK, MANA_CIRCLE_COLORS } from "./theme";

// ffmpeg-static exportiert den Pfad zur mitgelieferten ffmpeg-Binary
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string | null = require("ffmpeg-static");

const run = promisify(execFile);

const W = 1080;
const H = 1920;
const FPS = 30;
const FONT = FONT_STACK.replace(/"/g, "'");

// ===========================================================================
// Drehbuch
// ===========================================================================

/**
 * Ein Reel besteht aus Szenen ("Beats"). Jede Szene hat ihren eigenen
 * Bildinhalt und ihren eigenen Sprechtext - nichts wird zweimal gesagt, der
 * Commander-Name faellt genau einmal (Szene 2). Ablauf nach dem Muster, das
 * in ~/.claude/instagram/swipe.md am besten lief: Karte als Hauptmotiv,
 * kurzer Hook vorne, Text in < 1 s lesbar.
 */
type BeatKind = "hook" | "commander" | "plan" | "engine" | "curve" | "stats" | "price" | "cta";

interface Beat {
  kind: BeatKind;
  /** Mindestdauer in Sekunden (ohne Voice-over) */
  base: number;
  /** Sprech- und Untertiteltext */
  say: string;
}

export interface ReelScript {
  hook: string;
  beats: Beat[];
  analysis: DeckAnalysis;
}

const HOOKS: Record<string, string[]> = {
  tokens: ["Every spell here makes an army.", "One card in, five bodies out."],
  counters: ["This deck gets bigger every single turn.", "Small on turn three. Huge on turn six."],
  graveyard: ["Kill it. It comes back anyway.", "The graveyard is just a second hand."],
  aristocrats: ["Every creature that dies drains the table.", "Your board wipe is my win condition."],
  spellslinger: ["One spell is never enough here.", "Instants and sorceries, all the way down."],
  artifacts: ["Every artifact turns into value.", "Junk on the table, cards in the hand."],
  enchantress: ["Every enchantment draws a card.", "Auras, sagas, and a full grip."],
  landfall: ["Every land drop is an attack.", "Play a land. Watch the board explode."],
  blink: ["Same creature, same trigger, again and again.", "Flicker it twice, get paid twice."],
  lifegain: ["Gaining life has never hit this hard.", "Every life point is ammunition."],
  voltron: ["One creature. Twenty-one damage.", "Suit up one threat and end it."],
  dragons: ["Ramp into a sky full of dragons.", "Turn five: dragons. Turn six: game."],
};
const GENERIC_HOOKS = ["This deck punches way above its price.", "A commander nobody expects at the table."];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}
const pick = <T>(arr: T[], seed: string): T => arr[hash(seed) % arr.length];

function listJoin(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Text fuer TTS saeubern (Piper liest Sonderzeichen sonst seltsam vor) */
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const SYMBOL_WORDS: Record<string, string> = {
  T: "tap", Q: "untap", X: "X", C: "colorless", S: "snow", E: "energy",
  W: "white", U: "blue", B: "black", R: "red", G: "green",
};

/** Ein Manasymbol als Wort: {2} -> "two", {W} -> "white", {W/U} -> "white or blue" */
function symbolWord(sym: string): string {
  const inner = sym.replace(/[{}]/g, "");
  if (/^\d+$/.test(inner)) return NUMBER_WORDS[+inner] ?? inner;
  if (inner.includes("/")) {
    const [x, y] = inner.split("/");
    if (y === "P") return SYMBOL_WORDS[x] ?? x; // phyrexanisch
    return `${symbolWord(`{${x}}`)} or ${symbolWord(`{${y}}`)}`;
  }
  return SYMBOL_WORDS[inner] ?? inner;
}

/**
 * Manakosten in Sprache: "{1}, Sacrifice an artifact: X" -> "Pay one, sacrifice
 * an artifact: X", "{T}: Add {G}" -> "Tap: add green".
 */
function manaToWords(s: string): string {
  return s
    .replace(/(^|[.!]\s+)((?:\{[^}]+\})+)(?=[,:])/g, (_m, pre: string, cost: string) => {
      const syms = cost.match(/\{[^}]+\}/g) ?? [];
      const words = syms.map(symbolWord);
      const onlyTap = words.length === 1 && (words[0] === "tap" || words[0] === "untap");
      return pre + (onlyTap ? words[0].charAt(0).toUpperCase() + words[0].slice(1) : `Pay ${words.join(" ")}`);
    })
    .replace(/(?:\{[^}]+\})+/g, (cost) => (cost.match(/\{[^}]+\}/g) ?? []).map(symbolWord).join(" "));
}

function speakable(s: string): string {
  // Erst die eigenen Aussprache-Regeln (Einstellungen), dann aufraeumen
  return applyPronunciation(
    manaToWords(s)
      .replace(/€\s?(\d+)/g, "$1 euros")
      .replace(/&/g, " and ")
  )
    .replace(/[^\p{L}\p{N}\s.,!?'+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function reelScript(deck: Deck, hookOverride?: string): ReelScript {
  const a = analyzeDeck(deck);
  const seed = deck.commanders.map((c) => c.name).join("|");
  const tribal = /tribal$/.test(a.style) ? a.style.replace(/ tribal$/, "") : null;

  let hook = hookOverride?.trim() || "";
  if (!hook) {
    if (tribal) hook = `A whole army of ${tribal}. One leader.`;
    else if (a.archetypeId && HOOKS[a.archetypeId]) hook = pick(HOOKS[a.archetypeId], seed);
    else hook = pick(GENERIC_HOOKS, seed);
  }

  const price = Math.round(a.priceEur);
  // Alle Faehigkeiten vorlesen, solange es nicht zu lang wird (~260 Zeichen)
  const abilitiesSpoken: string[] = [];
  for (const ab of a.abilities) {
    if ([...abilitiesSpoken, ab].join(". ").length > 260 && abilitiesSpoken.length) break;
    abilitiesSpoken.push(ab);
  }
  const statParts = [
    a.stats.ramp ? `${a.stats.ramp} ramp` : null,
    a.stats.draw ? `${a.stats.draw} draw` : null,
    a.stats.removal ? `${a.stats.removal} removal` : null,
  ].filter((x): x is string => Boolean(x));

  const beats: Beat[] = [
    { kind: "hook", base: 2.6, say: hook },
    {
      kind: "commander",
      base: 4,
      say: abilitiesSpoken.length
        ? `Meet ${a.name}. ${abilitiesSpoken.join(". ")}.`
        : `Meet ${a.name}, ${a.combo} ${a.style}.`,
    },
  ];
  // Spielplan: Schritte ohne Klammer-Zusaetze ("Ramp (6 sources)" -> "ramp")
  const planSpoken = a.steps.map((st, i) => {
    const plain = st.replace(/\s*\([^)]*\)/g, "");
    return i === 0 ? plain : plain.charAt(0).toLowerCase() + plain.slice(1);
  });
  beats.push({ kind: "plan", base: 3.4, say: `The plan: ${planSpoken[0]}, ${planSpoken[1]}, then ${planSpoken[2]}.` });

  if (a.keyCards.length) {
    beats.push({
      kind: "engine",
      base: 5,
      // Kurznamen ("Toxrill" statt "Toxrill, the Corrosive") und je ein Satz, was die Karte tut
      say: `${ENGINE_INTRO[a.keyCards.length] ?? "These cards make it work."} ${a.keyCards
        .map((c) => `${shortName(c.name.split(" // ")[0])} ${cardRole(c)}.`)
        .join(" ")}`,
    });
  }

  const avg = a.avgManaValue.toFixed(1);
  const pace = a.avgManaValue < 2.8 ? "so it comes down fast" : a.avgManaValue < 3.5 ? "a smooth curve" : "so it goes big";
  beats.push({ kind: "curve", base: 3.2, say: `Average mana value ${avg}, ${pace}.` });

  if (statParts.length >= 2) {
    beats.push({ kind: "stats", base: 2.6, say: `${listJoin(statParts)} keep it running.` });
  }
  const priciest = a.priciest && a.priciest.priceEur >= 5 ? a.priciest : null;
  beats.push({
    kind: "price",
    base: priciest ? 3.2 : 2.2,
    say: `All of it for about ${price} euros.${priciest ? ` The priciest card is ${priciest.name.split(" // ")[0]}.` : ""}`,
  });
  beats.push({ kind: "cta", base: 2.6, say: "Full list in the caption. Follow for a new deck every day." });

  return { hook, beats, analysis: a };
}

// ===========================================================================
// Animierte Seite
// ===========================================================================

interface TimedBeat extends Beat {
  start: number;
  dur: number;
  /** Laenge der Sprachspur (0 ohne Voice-over) - fuer Untertitel-Timing */
  voiceSec: number;
}

/**
 * Layout-Regel: Szenen-Inhalt endet spaetestens bei y = 1370. Darunter liegt
 * der Untertitel-Streifen (1400-1540), danach Instagrams eigene Bedienelemente.
 */
const SUB_TOP = 1400;

function cardImg(url: string | null, cls: string, extra = ""): string {
  return url ? `<img class="${cls}" src="${escapeHtml(url)}" ${extra} alt="">` : "";
}

function beatHtml(b: TimedBeat, deck: Deck, s: ReelScript): string {
  const a = s.analysis;
  const cmd = deck.commanders[0];
  const attrs = `class="beat" data-start="${b.start}" data-dur="${b.dur}"`;
  switch (b.kind) {
    case "hook":
      return `<section ${attrs}>
        <div class="stack" style="top:170px">
          <div class="chip anim" data-d="0" data-y="-30">COMMANDER DECK TECH</div>
          <h1 class="hook anim" data-d="0.08" data-y="60" data-s="0.92">${escapeHtml(s.hook)}</h1>
        </div>
        <div class="stack" style="top:640px">
          ${cmd?.imageArtCrop ? `<div class="teaser anim" data-d="0.2" data-y="120" data-s="0.88" data-r="-4"><img src="${escapeHtml(cmd.imageArtCrop)}" alt=""></div>` : cardImg(cmd?.imageNormal ?? null, "card hero anim", 'data-d="0.25" data-y="140" data-s="0.85"')}
        </div>
      </section>`;
    case "commander":
      return `<section ${attrs}>
        <div class="stack" style="top:150px">
          <div class="eyebrow anim" data-d="0" data-y="-20">${escapeHtml(a.combo)} · ${escapeHtml(a.style)}</div>
          <h2 class="name anim" data-d="0.05" data-y="30">${escapeHtml(a.name)}</h2>
        </div>
        <div class="stack" style="top:370px">
          ${cardImg(cmd?.imageNormal ?? null, "card mid anim", 'data-d="0.1" data-x="260" data-r="8" data-s="0.9"')}
        </div>
        ${
          a.abilities.length
            ? (() => {
                // Je Faehigkeit eine Zeile, auf dem Bild hoechstens ~85 Zeichen
                // (vorgelesen wird alles); bei viel Text kleinere Schrift
                const cut = (t: string) => (t.length > 85 ? t.slice(0, 82).replace(/\s+\S*$/, "") + " …" : t);
                let txt = a.abilities.slice(0, 2).map(cut).join("\n");
                if (txt.length > 175) txt = txt.slice(0, 172) + "…";
                const small = txt.length > 95 ? " small" : "";
                return `<div class="stack" style="top:1040px"><p class="ability${small} anim" data-d="0.55" data-y="40">${escapeHtml(txt)}</p></div>`;
              })()
            : ""
        }
      </section>`;
    case "plan":
      return `<section ${attrs}>
        <div class="stack" style="top:230px">
          <div class="eyebrow anim" data-d="0" data-y="-20">THE GAME PLAN</div>
          <h2 class="title anim" data-d="0.05" data-y="30">How it wins</h2>
        </div>
        <div class="steps">
          ${a.steps
            .map(
              (st, i) => `<div class="step anim" data-d="${0.2 + i * 0.4}" data-x="-160">
                <div class="no">${i + 1}</div><div class="txt">${escapeHtml(st)}</div>
              </div>`
            )
            .join("")}
        </div>
      </section>`;
    case "curve": {
      const max = Math.max(1, ...a.curve);
      const bars = a.curve
        .map(
          (n, i) => `<div class="col">
            <div class="cnt" data-count="${n}" data-cd="${0.15 + i * 0.06}">0</div>
            <div class="bar" data-grow="${Math.round((n / max) * 420)}" data-gd="${0.15 + i * 0.06}"></div>
            <div class="mv">${i === 7 ? "7+" : i}</div>
          </div>`
        )
        .join("");
      const c = a.counts;
      return `<section ${attrs}>
        <div class="stack" style="top:230px">
          <div class="eyebrow anim" data-d="0" data-y="-20">MANA CURVE</div>
          <h2 class="title anim" data-d="0.05" data-y="30">Ø <span data-count10="${Math.round(a.avgManaValue * 10)}" data-cd="0.1">0.0</span> mana value</h2>
        </div>
        <div class="curve anim" data-d="0.1" data-y="40">${bars}</div>
        <div class="split anim" data-d="0.7" data-y="30">
          <span><b>${c.creatures}</b> creatures</span><span><b>${c.spells}</b> spells</span><span><b>${c.permanents}</b> other</span><span><b>${c.lands}</b> lands</span>
        </div>
      </section>`;
    }
    case "engine": {
      const rot = [-9, 0, 9];
      const dx = [-190, 0, 190];
      const cards = a.keyCards
        .map(
          (c, i) =>
            `<div class="fan anim" data-d="${0.15 + i * 0.35}" data-y="500" data-r="${rot[i] * 3}" style="transform-origin:50% 120%;--x:${dx[i]}px;--r:${rot[i]}deg;z-index:${i === 1 ? 3 : 2}">
              ${cardImg(c.imageNormal, "card small")}
            </div>`
        )
        .join("");
      return `<section ${attrs}>
        <div class="stack" style="top:200px">
          <div class="eyebrow anim" data-d="0" data-y="-20">THE ENGINE</div>
          <h2 class="title anim" data-d="0.05" data-y="30">Key pieces</h2>
        </div>
        <div class="fanrow">${cards}</div>
        <div class="roles">
          ${a.keyCards
            .map(
              (c, i) => `<div class="role anim" data-d="${0.5 + i * 0.35}" data-y="30"><b>${escapeHtml(shortName(c.name.split(" // ")[0]))}</b> ${escapeHtml(cardRole(c))}</div>`
            )
            .join("")}
        </div>
      </section>`;
    }
    case "stats": {
      const items: [string, number][] = [
        ["Ramp", a.stats.ramp],
        ["Draw", a.stats.draw],
        ["Removal", a.stats.removal],
      ];
      return `<section ${attrs}>
        <div class="stack" style="top:330px">
          <div class="eyebrow anim" data-d="0" data-y="-20">WHAT KEEPS IT RUNNING</div>
        </div>
        <div class="stats">
          ${items
            .map(
              ([label, n], i) => `<div class="stat anim" data-d="${0.1 + i * 0.18}" data-y="80">
                <div class="num" data-count="${n}" data-cd="${0.1 + i * 0.18}">0</div>
                <div class="label">${label}</div>
              </div>`
            )
            .join("")}
        </div>
      </section>`;
    }
    case "price": {
      const pc = a.priciest && a.priciest.priceEur >= 5 ? a.priciest : null;
      return `<section ${attrs}>
        <div class="stack" style="top:${pc ? 300 : 560}px">
          <div class="eyebrow anim" data-d="0" data-y="-20">THE WHOLE DECK</div>
          <div class="price anim" data-d="0.05" data-s="0.7"><span data-count="${Math.round(
            a.priceEur
          )}" data-cd="0.05" data-prefix="€">€0</span></div>
          <div class="sub anim" data-d="0.4" data-y="30">${a.cardCount} cards · Cardmarket trend</div>
          ${
            pc
              ? `<div class="priciest anim" data-d="0.9" data-y="80" data-s="0.9">
                  ${cardImg(pc.image, "card pcard")}
                  <div><div class="plabel">PRICIEST CARD</div><div class="pname">${escapeHtml(pc.name.split(" // ")[0])}</div><div class="pval">€${pc.priceEur.toFixed(2)}</div></div>
                </div>`
              : ""
          }
        </div>
      </section>`;
    }
    case "cta":
      return `<section ${attrs}>
        <div class="stack" style="top:440px">
          ${cardImg(cmd?.imageNormal ?? null, "card tiny anim", 'data-d="0" data-s="0.6"')}
          <h2 class="title anim" data-d="0.15" data-y="40">Full decklist<br>in the caption</h2>
          <div class="follow anim" data-d="0.45" data-y="40" data-s="0.9">Follow @floating.mana</div>
          <div class="sub anim" data-d="0.6" data-y="20">a new commander deck every day</div>
        </div>
      </section>`;
  }
}


function pageHtml(deck: Deck, s: ReelScript, beats: TimedBeat[], total: number, subtitles: boolean): string {
  const cmd = deck.commanders[0];
  const art = cmd?.imageArtCrop ?? cmd?.imageNormal ?? "";
  const accents = (deck.colorIdentity.length ? deck.colorIdentity : (["B"] as const)).map(
    (c) => MANA_CIRCLE_COLORS[c]
  );
  const accent = accents[0];

  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #111; font-family: ${FONT}; color: #fff; }
  #bg { position: absolute; inset: -120px; background: url('${escapeHtml(art)}') center/cover; filter: blur(46px) saturate(1.25) brightness(.55); }
  #shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10,10,12,.55) 0%, rgba(10,10,12,.15) 35%, rgba(10,10,12,.35) 70%, rgba(10,10,12,.85) 100%); }
  #glow { position: absolute; width: 1400px; height: 1400px; left: -160px; top: 260px; border-radius: 50%;
          background: radial-gradient(circle, ${accent}55 0%, transparent 60%); }
  .beat { position: absolute; inset: 0; opacity: 0; }
  .stack { position: absolute; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; gap: 26px; padding: 0 70px; text-align: center; }
  .anim { will-change: transform, opacity; }
  .chip { font-size: 30px; font-weight: 800; letter-spacing: 6px; padding: 12px 26px; border-radius: 999px; background: rgba(255,255,255,.14); border: 2px solid rgba(255,255,255,.35); }
  .hook { margin: 0; font-size: 96px; line-height: 1.05; font-weight: 900; letter-spacing: -2px; text-shadow: 0 8px 40px rgba(0,0,0,.6); }
  .eyebrow { font-size: 32px; font-weight: 800; letter-spacing: 5px; color: ${accent}; text-transform: uppercase; }
  .name { margin: 0; font-size: 88px; line-height: 1.02; font-weight: 900; letter-spacing: -2px; text-shadow: 0 8px 40px rgba(0,0,0,.6); }
  .title { margin: 0; font-size: 72px; line-height: 1.08; font-weight: 900; letter-spacing: -1.5px; text-shadow: 0 8px 40px rgba(0,0,0,.6); }
  .card { display: block; border-radius: 4.6% / 3.4%; box-shadow: 0 50px 120px rgba(0,0,0,.65); }
  .card.hero { width: 690px; }
  .teaser { width: 900px; height: 660px; border-radius: 36px; overflow: hidden; box-shadow: 0 50px 120px rgba(0,0,0,.65); border: 6px solid rgba(255,255,255,.18); }
  .teaser img { width: 100%; height: 100%; object-fit: cover; transform: scale(1.05); }
  .card.mid { width: 450px; }
  .card.small { width: 320px; }
  .card.tiny { width: 300px; margin-bottom: 20px; }
  .ability.small { font-size: 34px; }
  .roles { position: absolute; left: 70px; right: 70px; top: 1120px; display: grid; gap: 12px; }
  .role { font-size: 34px; line-height: 1.25; background: rgba(0,0,0,.5); border-radius: 18px; padding: 12px 22px; border-left: 6px solid ${accent}; }
  .role b { font-weight: 900; }
  .ability { margin: 0; font-size: 42px; line-height: 1.3; font-weight: 600; max-width: 900px; white-space: pre-line;
             background: rgba(0,0,0,.55); padding: 26px 34px; border-radius: 26px; border-left: 8px solid ${accent}; text-align: left; }
  .fanrow { position: absolute; left: 0; right: 0; top: 520px; height: 700px; }
  .fan { position: absolute; left: 50%; top: 40px; margin-left: -160px; }
  .stats { position: absolute; left: 70px; right: 70px; top: 520px; display: grid; gap: 34px; }
  .stat { display: flex; align-items: baseline; gap: 34px; background: rgba(0,0,0,.45); border-radius: 30px; padding: 30px 46px; border: 2px solid rgba(255,255,255,.12); }
  .stat .num { font-size: 170px; font-weight: 900; line-height: 1; min-width: 260px; color: ${accent}; font-variant-numeric: tabular-nums; }
  .stat .label { font-size: 72px; font-weight: 800; }
  .price { font-size: 250px; font-weight: 900; line-height: 1; letter-spacing: -6px; color: ${accent}; font-variant-numeric: tabular-nums; text-shadow: 0 10px 60px rgba(0,0,0,.6); }
  .sub { font-size: 42px; font-weight: 600; color: rgba(255,255,255,.85); }
  .follow { font-size: 54px; font-weight: 900; color: #1F1D18; background: ${accent}; padding: 22px 44px; border-radius: 999px; }
  .steps { position: absolute; left: 70px; right: 70px; top: 520px; display: grid; gap: 30px; }
  .step { display: flex; align-items: center; gap: 34px; background: rgba(0,0,0,.45); border: 2px solid rgba(255,255,255,.12); border-radius: 30px; padding: 30px 40px; }
  .step .no { flex: none; width: 120px; height: 120px; border-radius: 50%; background: ${accent}; color: #1F1D18; font-size: 72px; font-weight: 900; display: flex; align-items: center; justify-content: center; }
  .step .txt { font-size: 60px; font-weight: 800; line-height: 1.1; text-align: left; }
  .curve { position: absolute; left: 70px; right: 70px; top: 500px; height: 560px; display: grid; grid-template-columns: repeat(8, 1fr); gap: 14px; align-items: end; }
  .curve .col { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
  .curve .cnt { font-size: 40px; font-weight: 800; margin-bottom: 10px; font-variant-numeric: tabular-nums; }
  .curve .bar { width: 100%; height: 0; border-radius: 14px 14px 4px 4px; background: linear-gradient(180deg, ${accent}, ${accent}99); }
  .curve .mv { margin-top: 14px; font-size: 38px; font-weight: 800; color: rgba(255,255,255,.75); }
  .split { position: absolute; left: 70px; right: 70px; top: 1150px; display: flex; flex-wrap: wrap; justify-content: center; gap: 14px 34px; font-size: 40px; color: rgba(255,255,255,.85); }
  .split b { color: #fff; font-weight: 900; }
  .priciest { display: flex; align-items: center; gap: 34px; margin-top: 30px; background: rgba(0,0,0,.45); border: 2px solid rgba(255,255,255,.12); border-radius: 30px; padding: 24px 34px; text-align: left; }
  .card.pcard { width: 230px; box-shadow: 0 20px 50px rgba(0,0,0,.5); }
  .plabel { font-size: 28px; font-weight: 800; letter-spacing: 4px; color: ${accent}; }
  .pname { font-size: 52px; font-weight: 900; line-height: 1.05; margin: 8px 0; max-width: 560px; }
  .pval { font-size: 46px; font-weight: 700; color: rgba(255,255,255,.85); }
  #progress { position: absolute; top: 70px; left: 70px; right: 70px; display: flex; gap: 10px; }
  #progress div { flex: 1; height: 8px; border-radius: 4px; background: rgba(255,255,255,.25); overflow: hidden; }
  #progress i { display: block; height: 100%; width: 0; background: #fff; }
  /* Eigener Streifen unter allen Szenen-Inhalten; Stuecke von max. 2 Zeilen */
  #sub { position: absolute; left: 80px; right: 80px; top: ${SUB_TOP}px; height: 140px; display: ${subtitles ? "flex" : "none"};
         align-items: flex-start; justify-content: center; text-align: center; }
  #sub span { font-size: 46px; line-height: 1.3; font-weight: 800; background: rgba(0,0,0,.62); padding: 6px 20px; border-radius: 14px;
         box-decoration-break: clone; -webkit-box-decoration-break: clone; }
  #handle { position: absolute; bottom: 120px; width: 100%; text-align: center; font-size: 32px; font-weight: 700; color: rgba(255,255,255,.6); }
</style></head><body>
  <div id="bg"></div><div id="glow"></div><div id="shade"></div>
  <div id="progress">${beats.map(() => "<div><i></i></div>").join("")}</div>
  ${beats.map((b) => beatHtml(b, deck, s)).join("\n")}
  <div id="sub"></div>
  <div id="handle">@floating.mana</div>
<script>
  const TOTAL = ${total};
  const BEATS = ${JSON.stringify(beats.map((b) => ({ start: b.start, dur: b.dur, say: b.say, voice: b.voiceSec })))};
  // Untertitel in Stuecke von max. 2 Zeilen teilen: zuerst an Satzzeichen
  // (damit nichts mitten im Satzteil abreisst), nur zu lange Teile nach
  // Woertern; danach proportional zur Textlaenge ueber die Sprechdauer verteilen
  const MAX = 52, WRAP = 40;
  BEATS.forEach((b) => {
    const clauses = b.say.split(/(?<=[.,:;!?])\\s+/).filter(Boolean);
    const parts = [];
    for (const c of clauses) {
      if (c.length <= MAX) { parts.push(c); continue; }
      let cur = "";
      for (const w of c.split(/\\s+/)) {
        if (cur && (cur + " " + w).length > WRAP) { parts.push(cur); cur = w; } else cur = cur ? cur + " " + w : w;
      }
      if (cur) parts.push(cur);
    }
    // kurze Reste mit dem Nachbarn zusammenlegen
    const chunks = [];
    for (const p of parts) {
      const last = chunks[chunks.length - 1];
      if (last && (last.length < 16 || p.length < 16) && (last + " " + p).length <= MAX) chunks[chunks.length - 1] = last + " " + p;
      else chunks.push(p);
    }
    const span = (b.voice || b.dur - 0.3), total = chunks.reduce((n, c) => n + c.length, 0);
    let at = b.start + 0.15;
    b.chunks = chunks.map((c) => { const s = at; at += span * (c.length / total); return { from: s, text: c }; });
  });
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeOutBack = (t) => { const c = 1.4; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const sections = [...document.querySelectorAll(".beat")];
  const bars = [...document.querySelectorAll("#progress i")];
  const sub = document.getElementById("sub");
  const bg = document.getElementById("bg");
  const glow = document.getElementById("glow");

  window.renderAt = (t) => {
    // Hintergrund: langsamer Ken-Burns ueber das ganze Video, Glow wandert
    const g = t / TOTAL;
    bg.style.transform = "scale(" + (1.18 - 0.14 * g) + ") translateY(" + (-30 * g) + "px)";
    glow.style.transform = "translate(" + (Math.sin(t * 0.6) * 90) + "px," + (Math.cos(t * 0.45) * 120) + "px)";

    sections.forEach((sec, i) => {
      const start = +sec.dataset.start, dur = +sec.dataset.dur, lt = t - start;
      const fadeIn = i === 0 ? 1 : clamp(lt / 0.22);
      const fadeOut = clamp((start + dur - t) / 0.22);
      const visible = lt >= 0 && lt <= dur;
      sec.style.opacity = visible ? String(Math.min(fadeIn, i === sections.length - 1 ? 1 : fadeOut)) : "0";
      // Szene schiebt sich beim Ausblenden leicht nach oben
      sec.style.transform = "translateY(" + ((1 - fadeOut) * -60) + "px)";
      if (!visible) return;

      sec.querySelectorAll(".anim").forEach((el) => {
        const d = +(el.dataset.d || 0), p = clamp((lt - d) / 0.55);
        const e = easeOutBack(p), o = easeOut(clamp((lt - d) / 0.3));
        const x = (+el.dataset.x || 0) * (1 - e), y = (+el.dataset.y || 0) * (1 - e);
        const s0 = el.dataset.s ? +el.dataset.s : 1, sc = s0 + (1 - s0) * e;
        const r0 = +el.dataset.r || 0;
        // Faecher-Karten behalten ihre Endposition (--x/--r)
        const fx = el.classList.contains("fan") ? getComputedStyle(el).getPropertyValue("--x") : "0px";
        const fr = el.classList.contains("fan") ? parseFloat(getComputedStyle(el).getPropertyValue("--r")) : 0;
        const drift = el.classList.contains("card") || el.classList.contains("fan") ? Math.sin((lt + d) * 1.3) * 6 : 0;
        el.style.opacity = String(o);
        el.style.transform = "translate(calc(" + fx + " + " + x + "px)," + (y + drift) + "px) rotate(" + (fr + r0 * (1 - e)) + "deg) scale(" + sc + ")";
      });
      sec.querySelectorAll("[data-count]").forEach((el) => {
        const p = easeOut(clamp((lt - (+el.dataset.cd || 0)) / 0.9));
        el.textContent = (el.dataset.prefix || "") + Math.round(+el.dataset.count * p);
      });
      // Kommazahl (Zehntel), z. B. durchschnittlicher Manawert
      sec.querySelectorAll("[data-count10]").forEach((el) => {
        const p = easeOut(clamp((lt - (+el.dataset.cd || 0)) / 0.9));
        el.textContent = ((+el.dataset.count10 * p) / 10).toFixed(1);
      });
      // Balken wachsen hoch
      sec.querySelectorAll("[data-grow]").forEach((el) => {
        const p = easeOut(clamp((lt - (+el.dataset.gd || 0)) / 0.8));
        el.style.height = (+el.dataset.grow * p) + "px";
      });
    });

    BEATS.forEach((b, i) => { bars[i].style.width = (clamp((t - b.start) / b.dur) * 100) + "%"; });
    const cur = BEATS.find((b) => t >= b.start && t < b.start + b.dur) || BEATS[BEATS.length - 1];
    const chunk = [...cur.chunks].reverse().find((c) => t >= c.from);
    const text = chunk ? chunk.text : "";
    if (sub.dataset.text !== text) {
      sub.dataset.text = text;
      sub.innerHTML = text ? "<span></span>" : "";
      if (text) sub.firstChild.textContent = text;
    }
  };

  window.assetsReady = () => Promise.all([...document.images].map((img) =>
    img.complete ? Promise.resolve() : new Promise((r) => { img.onload = img.onerror = r; })
  ));
</script>
</body></html>`;
}

// ===========================================================================
// Rendern + Ton
// ===========================================================================

export interface ReelOptions {
  /** Eigener Hook; leer = aus dem Deck abgeleitet */
  hook?: string;
  /** Fortschritt (Schritt, 0..1) fuer die Anzeige in der App */
  onProgress?: (step: string, progress?: number) => void;
  /** Untertitel auch ohne Voice-over einblenden */
  subtitles?: boolean;
}

/**
 * Rendert das Reel Bild fuer Bild (Puppeteer) und kodiert es mit ffmpeg.
 * Mit PIPER_BIN/PIPER_MODEL bekommt jede Szene ihre eigene Sprachspur und
 * dauert so lange wie ihr Satz; sonst Untertitel-frei und stumm.
 */
export async function buildReel(deck: Deck, jobDir: string, opts: ReelOptions = {}): Promise<string> {
  if (!ffmpegPath) throw new Error("ffmpeg-static binary not available on this platform");
  const script = reelScript(deck, opts.hook);
  const report = opts.onProgress ?? (() => undefined);

  // 1. Voice-over je Szene (optional)
  const voices: ({ file: string; seconds: number } | null)[] = [];
  for (let i = 0; i < script.beats.length; i++) {
    if (ttsEngine() !== "none") report(`Reel: Sprachaufnahme ${i + 1}/${script.beats.length}`, (i / script.beats.length) * 0.08);
    voices.push(await synthesizeVoice(speakable(script.beats[i].say), jobDir, `reel-voice-${i}.wav`));
  }
  const withVoice = voices.some(Boolean);

  // 2. Zeitachse: Szene so lang wie Mindestdauer bzw. Satz + Luft
  let t = 0;
  const beats: TimedBeat[] = script.beats.map((b, i) => {
    const v = voices[i];
    const dur = Math.max(b.base, v ? v.seconds + 0.45 : 0);
    const tb = { ...b, start: t, dur, voiceSec: v ? v.seconds : 0 };
    t += dur;
    return tb;
  });
  const total = t;
  const frames = Math.round(total * FPS);

  // 3. ffmpeg vorbereiten: Bilder kommen per Pipe, Ton als Datei(en)
  const out = path.join(jobDir, "reel.mp4");
  const args = ["-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-"];
  const audioInputs: { idx: number; delayMs: number }[] = [];
  if (withVoice) {
    voices.forEach((v, i) => {
      if (!v) return;
      args.push("-i", v.file);
      audioInputs.push({ idx: audioInputs.length + 1, delayMs: Math.round((beats[i].start + 0.15) * 1000) });
    });
    const parts = audioInputs.map((a) => `[${a.idx}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${a.delayMs}|${a.delayMs}[a${a.idx}]`);
    const mix = `${audioInputs.map((a) => `[a${a.idx}]`).join("")}amix=inputs=${audioInputs.length}:normalize=0,apad,atrim=0:${total.toFixed(3)}[a]`;
    args.push("-filter_complex", [...parts, mix].join(";"), "-map", "0:v", "-map", "[a]");
  } else {
    args.push("-f", "lavfi", "-t", total.toFixed(3), "-i", "anullsrc=r=44100:cl=stereo", "-map", "0:v", "-map", "1:a");
  }
  args.push(
    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", out
  );

  const ff = spawn(ffmpegPath, args);
  let ffErr = "";
  ff.stderr.on("data", (d) => (ffErr = (ffErr + d).slice(-4000)));
  const ffDone = new Promise<void>((resolve, reject) => {
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${ffErr.slice(-800)}`))));
  });

  // 4. Seite rendern und Bild fuer Bild aufnehmen
  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.setContent(pageHtml(deck, script, beats, total, withVoice || Boolean(opts.subtitles)), { waitUntil: "networkidle0", timeout: 90_000 });
    await page.evaluate("window.assetsReady()");
    report("Reel: lade Kartenbilder", 0.08);
    const coverFrame = Math.min(frames - 1, Math.round(1.8 * FPS));
    for (let f = 0; f < frames; f++) {
      if (f % 15 === 0) report(`Reel: rendere Bild ${f + 1} von ${frames}`, 0.1 + 0.85 * (f / frames));
      await page.evaluate(`window.renderAt(${(f / FPS).toFixed(4)})`);
      const buf = (await page.screenshot({ type: "jpeg", quality: 90 })) as Buffer;
      // Titelbild aus der Hook-Szene (Vorschau in der App + Reel-Cover bei Instagram)
      if (f === coverFrame) fs.writeFileSync(reelCoverPath(out), buf);
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    }
  } catch (err) {
    ff.kill("SIGKILL");
    throw err;
  } finally {
    ff.stdin.end();
    if (browser) await browser.close();
  }
  report("Reel: Video wird fertig kodiert", 0.96);
  await ffDone;
  voices.forEach((v) => v && fs.rmSync(v.file, { force: true }));
  return out;
}

/** Titelbild, das buildReel neben dem Video ablegt */
export function reelCoverPath(videoFile: string): string {
  return videoFile.replace(/\.mp4$/i, "-cover.jpg");
}

/**
 * Text-to-Speech mit Piper (https://github.com/rhasspy/piper), laeuft lokal
 * und kostenlos. Ohne PIPER_BIN/PIPER_MODEL gibt es kein Voice-over.
 */
/** Welche Sprachausgabe aktiv ist */
export function ttsEngine(): "kokoro" | "piper" | "none" {
  const e = config.ttsEngine.toLowerCase();
  if (e === "kokoro" || e === "none") return e;
  if (e === "piper" || (!e && config.piperBin && config.piperModel)) return config.piperBin ? "piper" : "none";
  return "none";
}

// Kokoro-Modell nur einmal laden (dauert beim ersten Mal, danach im Speicher)
let kokoroModel: Promise<any> | null = null;
function loadKokoro(): Promise<any> {
  if (!kokoroModel) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { KokoroTTS, env } = require("kokoro-js");
    // Modell in DATA_DIR ablegen, damit "npm ci" es nicht loescht
    env.cacheDir = path.join(config.dataDir, "models");
    const loading: Promise<any> = KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
      dtype: config.kokoroDtype,
      device: "cpu",
    });
    loading.catch(() => (kokoroModel = null)); // naechster Versuch darf neu laden
    kokoroModel = loading;
  }
  return kokoroModel;
}

async function synthesizeVoice(
  text: string,
  jobDir: string,
  fileName: string
): Promise<{ file: string; seconds: number } | null> {
  const engine = ttsEngine();
  if (engine === "none" || !ffmpegPath || !text) return null;
  const file = path.join(jobDir, fileName);
  if (engine === "kokoro") {
    const tts = await loadKokoro();
    const audio = await tts.generate(text, { voice: config.ttsVoice, speed: config.ttsSpeed });
    await audio.save(file);
  } else {
    await new Promise<void>((resolve, reject) => {
      const p = spawn(config.piperBin, ["--model", config.piperModel, "--output_file", file]);
      let stderr = "";
      p.stderr.on("data", (d) => (stderr += d));
      p.on("error", reject);
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`piper exit ${code}: ${stderr.slice(-300)}`))));
      p.stdin.end(text);
    });
  }
  const probe = await run(ffmpegPath, ["-i", file], { maxBuffer: 8 * 1024 * 1024 }).catch(
    (e: { stderr?: string }) => ({ stderr: e.stderr ?? "" })
  );
  const m = String(probe.stderr).match(/Duration: (\d+):(\d+):([\d.]+)/);
  const seconds = m ? +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]) : 3;
  return { file, seconds };
}

// ===========================================================================
// Story-Grafik "Neuer Post" (Einzelbild)
// ===========================================================================

function toDataUri(file: string): string {
  const ext = path.extname(file).slice(1).toLowerCase().replace("jpg", "jpeg");
  return `data:image/${ext};base64,${fs.readFileSync(file).toString("base64")}`;
}

function backdrop(artUrl: string | null): string {
  return artUrl
    ? `<div style="position:absolute;inset:-60px;background:url('${escapeHtml(artUrl)}') center/cover;filter:blur(38px) brightness(0.45) saturate(1.2);"></div>`
    : `<div style="position:absolute;inset:0;background:#1F1D18;"></div>`;
}

async function renderStill(html: string, file: string): Promise<void> {
  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 60_000 });
    await page.screenshot({ path: file as `${string}.jpeg`, type: "jpeg", quality: 92 });
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Story-Grafik "Neuer Post": Cover des Carousels gerahmt auf geblurrtem
 * Artwork mit "NEW POST"-Hinweis. Nicht klickbar - Beitrag teilen und
 * Link-Sticker kann die Instagram-API nicht.
 */
export async function buildNewPostStory(deck: Deck, coverFile: string, jobDir: string): Promise<string> {
  const c = deck.commanders[0];
  const html = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;position:relative;font-family:${FONT};">
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
  const out = path.join(jobDir, "story-new-post.jpg");
  await renderStill(html, out);
  return out;
}
