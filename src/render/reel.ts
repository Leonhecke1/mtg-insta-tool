import * as fs from "fs";
import * as path from "path";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import puppeteer, { Browser } from "puppeteer";
import { config } from "../config";
import { spawnFfmpeg } from "./procs";
import { buildSoundtrack, Cue } from "./sound";
import { audioArgs, LAND, STYLE_HTML, STYLE_JS, styleCss } from "./reelStyle";
import { Deck } from "../types";
import { analyzeDeck, cardRole, DeckAnalysis, shortName } from "../llm/fallback";

const ENGINE_INTRO: Record<number, string> = { 1: "One card makes it work.", 2: "Two cards make it work.", 3: "Three cards make it work." };
import { applyPronunciation } from "../settings/pronunciation";
import { optimizeForSpeech } from "../skills/ttsText";
import { end, lcFirst } from "../skills/narration";
import { getSettings } from "../settings/appSettings";
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
  /** Kurzfassung des Hooks fuer das Bild (hoechstens ~6 Woerter) */
  hookScreen: string;
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
/** Fuer den Fragen-Hook: "How does a 118 euro deck ...?" */
const QUESTION: Record<string, string> = {
  tokens: "make an army every turn", counters: "grow out of control", graveyard: "keep coming back from the graveyard",
  aristocrats: "drain the whole table", spellslinger: "chain spell after spell", artifacts: "turn junk into value",
  enchantress: "draw a card off every enchantment", landfall: "turn every land drop into an attack",
  blink: "get every trigger twice", lifegain: "turn life into damage", voltron: "end games with one creature",
  dragons: "fill the sky with dragons",
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
export function manaToWords(s: string): string {
  return s
    .replace(/(^|[.!]\s+)((?:\{[^}]+\})+)(?=[,:])/g, (_m, pre: string, cost: string) => {
      const syms = cost.match(/\{[^}]+\}/g) ?? [];
      const words = syms.map(symbolWord);
      const onlyTap = words.length === 1 && (words[0] === "tap" || words[0] === "untap");
      return pre + (onlyTap ? words[0].charAt(0).toUpperCase() + words[0].slice(1) : `Pay ${words.join(" ")}`);
    })
    .replace(/(?:\{[^}]+\})+/g, (cost) => (cost.match(/\{[^}]+\}/g) ?? []).map(symbolWord).join(" "));
}

export function speakable(s: string): string {

  // Reihenfolge: Mana -> eigene Aussprache-Regeln -> Sprech-Optimierung (Pausen, Abkuerzungen, lange Saetze)
  return optimizeForSpeech(applyPronunciation(
    manaToWords(s)
      .replace(/€\s?(\d+)/g, "$1 euros")
      .replace(/&/g, " and ")
  ))
    .replace(/[^\p{L}\p{N}\s.,!?'+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Faehigkeit als gesprochener Satz. Aktivierte Faehigkeiten ("{T}, Tap ten Elves: Each
 * opponent loses 10 life") klingen vorgelesen holprig -> "And if you activate its ability, ..."
 */
function spokenAbility(ab: string, i: number): string {
  const act = ab.match(/^[^.]*?(?:\{[^}]+\}|\btap\b|\bsacrifice\b)[^.:]*:\s*(.+)$/i);
  if (act) return `${i === 0 ? "If" : "And if"} you activate its ability, ${lcFirst(act[1])}`;
  return i === 0 ? ab : `On top of that, ${lcFirst(ab)}`;
}

export function reelScript(deck: Deck, hookOverride?: string, length: "short" | "full" = getSettings().reelLength): ReelScript {
  const a = analyzeDeck(deck);
  const seed = deck.commanders.map((c) => c.name).join("|");
  const tribal = /tribal$/.test(a.style) ? a.style.replace(/ tribal$/, "") : null;

  const price = Math.round(a.priceEur);
  const euros = (n: number) => (n < 1 ? `${Math.round(n * 100)} cents` : n < 10 ? `${n.toFixed(2)} euros` : `${Math.round(n)} euros`);
  const eurosScreen = (n: number) => (n < 10 ? `€${n.toFixed(2)}` : `€${Math.round(n)}`);

  // Schluesselkarten nach Preis absteigend: #3 ist die guenstigste -> Aufloesung des Hooks
  a.keyCards = [...a.keyCards].sort((x, y) => (y.priceEur ?? 0) - (x.priceEur ?? 0));
  const third = a.keyCards.length === 3 ? a.keyCards[2] : null;

  // Hook nach /ig-reel: oeffnet eine Frage, die das Reel spaeter beantwortet.
  // Gesprochen und auf dem Bild getrennt (Bild: hoechstens ~6 Woerter).
  const options: { say: string; screen: string }[] = [];
  if (third && third.priceEur != null && third.priceEur > 0) {
    options.push({
      say: `Three cards make this deck work, and the third one costs ${euros(third.priceEur)}.`,
      screen: `3 cards. #3 costs ${eurosScreen(third.priceEur)}`,
    });
  }
  const question = (a.archetypeId && QUESTION[a.archetypeId]) || "win this many games";
  options.push({ say: `How does a ${price} euro deck ${question}?`, screen: `€${price} deck. How?` });
  if (tribal) options.push({ say: `A whole army of ${tribal}. One leader.`, screen: `A whole army of ${tribal}` });
  else if (a.archetypeId && HOOKS[a.archetypeId]) {
    const h = pick(HOOKS[a.archetypeId], seed);
    options.push({ say: h, screen: h.split(/\s+/).length <= 6 ? h : h.split(/[.,]/)[0] });
  }
  let hookPick = pick(options, seed);
  if (hookOverride?.trim()) hookPick = { say: hookOverride.trim(), screen: hookOverride.trim() };
  const hook = hookPick.say;
  // nur wenn wirklich der "3 cards"-Hook gewaehlt wurde (Preis der 3. Karte bekannt)
  const numberedHook = third !== null && (third.priceEur ?? 0) > 0 && hookPick === options[0] && !hookOverride?.trim();
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
        ? // Faehigkeiten mit Ueberleitung verbinden statt Stichpunkte
          `So this is ${a.name}. ${abilitiesSpoken.map((ab, i) => end(spokenAbility(ab, i))).join(" ")}`
        : `So this is ${a.name}, a ${a.combo} ${a.style} commander.`,
    },
  ];
  // Spielplan: Schritte ohne Klammer-Zusaetze ("Ramp (6 sources)" -> "ramp")
  const planSpoken = a.steps.map((st, i) => {
    const plain = st.replace(/\s*\([^)]*\)/g, "");
    return plain.charAt(0).toLowerCase() + plain.slice(1);
  });
  beats.push({ kind: "plan", base: 3.4, say: `The game plan is pretty simple. You ${planSpoken[0]}, ${planSpoken[1]}, and then you ${planSpoken[2]}.` });

  if (a.keyCards.length) {
    // Kurznamen ("Toxrill" statt "Toxrill, the Corrosive") und je ein Satz, was die Karte tut.
    // Beim nummerierten Hook loest #3 die offene Frage auf.
    const nm = (c: (typeof a.keyCards)[number]) => shortName(c.name.split(" // ")[0]);
    const ORD = ["Number one", "Number two", "And number three"];
    // Warum die Karte zur Engine gehoert (Bezug zum Commander), siehe src/llm/engine.ts
    const whyRaw = (c: (typeof a.keyCards)[number]) => a.engineWhy[c.name] ?? cardRole(c);
    // gleiche Begruendung wie die Karte davor nicht wortgleich wiederholen
    const MV_WHY = /^costs (\d+) mana, so .* (?:deal|draw you|gain you|mill|get a bonus worth) (.+)$/;
    const why = (c: (typeof a.keyCards)[number]) => {
      const i = a.keyCards.indexOf(c);
      const raw = whyRaw(c);
      if (i > 0 && whyRaw(a.keyCards[i - 1]) === raw) return "does the same job, so you have a backup";
      // zweiter grosser Zauber (Manawert-Commander): kurz statt den ganzen Satz zu wiederholen
      const mv = raw.match(MV_WHY);
      if (mv && a.keyCards.slice(0, i).some((x) => MV_WHY.test(whyRaw(x)))) return `is another big one at ${mv[1]} mana, so that's another ${mv[2]}`;
      return raw;
    };
    const say = numberedHook
      ? a.keyCards
          .map((c, i) =>
            i === 2
              ? `And number three, the one for ${euros(c.priceEur ?? 0)}, is ${nm(c)}. It ${why(c)}.`
              : `${ORD[i]} is ${nm(c)}. It ${why(c)}.`
          )
          .join(" ")
      : `So what actually makes this deck tick? ${a.keyCards
          .map((c, i) => (i === 0 ? `${nm(c)} ${why(c)}.` : i === a.keyCards.length - 1 ? `And ${nm(c)} ${why(c)}.` : `Then there's ${nm(c)}, which ${why(c)}.`))
          .join(" ")}`;
    beats.push({ kind: "engine", base: 5.5, say });
  }

  const avg = a.avgManaValue.toFixed(1);
  const pace = a.avgManaValue < 2.8 ? "so it gets going really fast" : a.avgManaValue < 3.5 ? "which gives you a nice, steady curve" : "so this deck is planning to go big";
  beats.push({ kind: "curve", base: 3.2, say: `On average, the cards cost about ${avg} mana, ${pace}.` });

  if (statParts.length >= 2) {
    beats.push({ kind: "stats", base: 2.6, say: `And to keep it all running, you've got ${listJoin(statParts)}.` });
  }
  const priciest = a.priciest && a.priciest.priceEur >= 5 ? a.priciest : null;
  beats.push({
    kind: "price",
    base: priciest ? 3.4 : 2.4,
    say: `And the best part? All of this costs about ${price} euros.${
      priciest ? ` The most expensive card in there is ${shortName(priciest.name.split(" // ")[0])} at ${euros(priciest.priceEur)}.` : ""
    }`,
  });
  // Schluss mit einer Frage (bringt Kommentare) statt "Follow"
  beats.push({ kind: "cta", base: 2.8, say: "So, which card would you swap out first? Let me know in the comments." });

  // Kurz (~15 s): die Kernaussage muss vor der durchschnittlichen Wiedergabedauer
  // kommen (/ig-reel: das Versprechen vor der Haelfte einloesen)
  const SHORT: BeatKind[] = ["hook", "commander", "engine", "price", "cta"];
  const final = length === "short" ? beats.filter((b) => SHORT.includes(b.kind)) : beats;
  return { hook, hookScreen: hookPick.screen, beats: final, analysis: a };
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

/** Preis-Szene: Zaehler steht (cd 0.05 + 0.9 s) -> Aufprall + Burst */
const PRICE_HIT = 0.95;

/** Soundeffekte und Aufprall-Momente passend zu den Einflug-Animationen der Szenen */
function deckCues(beats: TimedBeat[], s: ReelScript): { cues: Cue[]; impacts: [number, number][]; resolveAt: number } {
  const cues: Cue[] = [];
  const impacts: [number, number][] = [];
  let resolveAt = beats[beats.length - 1].start;
  beats.forEach((b, i) => {
    const at = (d: number) => b.start + d;
    if (i > 0) cues.push({ at: at(-0.22), kind: "whoosh" });
    switch (b.kind) {
      case "hook":
        // erste Szene startet 0.35 s "vorgespult" (Bild 1 schon in Bewegung)
        cues.push({ at: at(0.05), kind: "sparkle", gain: 0.6 }, { at: at(0.2 + LAND - 0.35), kind: "thud" });
        impacts.push([at(0.2 + LAND - 0.35), 0.3]);
        break;
      case "commander":
        cues.push({ at: at(0.1 + LAND), kind: "thud" });
        impacts.push([at(0.1 + LAND), 0.25]);
        break;
      case "plan":
        s.analysis.steps.forEach((_, k) => cues.push({ at: at(0.2 + k * 0.4 + LAND), kind: "pop", gain: 0.7 }));
        break;
      case "curve":
        for (let d = 0.15; d < 1.0; d += 0.08) cues.push({ at: at(d), kind: "tick", gain: 0.5 });
        break;
      case "engine":
        s.analysis.keyCards.forEach((_, k) => {
          cues.push({ at: at(0.15 + k * 0.35 + LAND), kind: "thud", gain: 0.8 });
          impacts.push([at(0.15 + k * 0.35 + LAND), 0.2]);
        });
        break;
      case "stats":
        [0, 1, 2].forEach((k) => cues.push({ at: at(0.1 + k * 0.18 + LAND), kind: "pop", gain: 0.7 }));
        break;
      case "price":
        cues.push({ at: at(PRICE_HIT - 1.6), kind: "riser", dur: 1.6 });
        for (let d = 0.05; d < PRICE_HIT; d += 0.07) cues.push({ at: at(d), kind: "tick", gain: 0.6 });
        cues.push({ at: at(PRICE_HIT), kind: "impact" }, { at: at(PRICE_HIT + 0.05), kind: "sparkle" });
        impacts.push([at(PRICE_HIT), 1]);
        resolveAt = at(PRICE_HIT);
        break;
      case "cta":
        cues.push({ at: at(0.3), kind: "sparkle", gain: 0.7 });
        break;
    }
  });
  return { cues, impacts, resolveAt };
}

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
          <h1 class="hook anim" data-d="0.08" data-y="60" data-s="0.92">${escapeHtml(s.hookScreen)}</h1>
        </div>
        <div class="stack" style="top:640px">
          ${cmd?.imageArtCrop ? `<div class="teaser anim" data-d="0.2" data-y="120" data-s="0.88" data-r="-4"><img src="${escapeHtml(cmd.imageArtCrop)}" alt=""></div>` : cardImg(cmd?.imageNormal ?? null, "card hero anim", 'data-d="0.25" data-y="140" data-s="0.85"')}
        </div>
      </section>`;
    case "commander":
      return `<section ${attrs}>
        <div class="stack" style="top:150px">
          <div class="eyebrow anim" data-d="0" data-y="-20">${escapeHtml(a.combo)} · ${escapeHtml(a.style)}</div>
          <h2 class="name anim${a.name.length > 22 ? " long" : ""}" data-d="0.05" data-y="30">${escapeHtml(a.name)}</h2>
        </div>
        <div class="stack" style="top:${a.name.length > 22 ? 470 : 400}px">
          ${cardImg(cmd?.imageNormal ?? null, "card big anim", 'data-d="0.1" data-x="260" data-r="8" data-s="0.9"')}
        </div>
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
              ${cardImg(c.imageNormal, "card fancard")}
            </div>`
        )
        .join("");
      return `<section ${attrs}>
        <div class="stack" style="top:200px">
          <div class="eyebrow anim" data-d="0" data-y="-20">THE ENGINE</div>
          <h2 class="title anim" data-d="0.05" data-y="30">How it all connects</h2>
        </div>
        <div class="fanrow">${cards}</div>
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
        <div class="burst" data-at="${PRICE_HIT}" style="top:${(pc ? 300 : 560) + 190}px"></div>
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
        <div class="stack" style="top:330px">
          ${cardImg(cmd?.imageNormal ?? null, "card tiny anim", 'data-d="0" data-s="0.6"')}
          <h2 class="title anim" data-d="0.15" data-y="40">Which card would<br>you swap first?</h2>
          <div class="follow anim" data-d="0.45" data-y="40" data-s="0.9">Tell me in the comments</div>
          <div class="sub anim" data-d="0.6" data-y="20">Full decklist in the first comment</div>
        </div>
      </section>`;
  }
}


function pageHtml(deck: Deck, s: ReelScript, beats: TimedBeat[], total: number, subtitles: boolean, impacts: [number, number][]): string {
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
  .card.big { width: 560px; }
  .name.long { font-size: 68px; }
  .card.fancard { width: 380px; }
  .card.small { width: 320px; }
  .card.tiny { width: 300px; margin-bottom: 20px; }
  .fanrow { position: absolute; left: 0; right: 0; top: 520px; height: 700px; }
  .fan { position: absolute; left: 50%; top: 40px; margin-left: -190px; }
  .stats { position: absolute; left: 70px; right: 70px; top: 520px; display: grid; gap: 34px; }
  .stat { display: flex; align-items: baseline; gap: 34px; padding: 10px 46px; }
  .stat .num { text-shadow: 0 10px 50px rgba(0,0,0,.6); }
  .stat .num { font-size: 170px; font-weight: 900; line-height: 1; min-width: 260px; color: ${accent}; font-variant-numeric: tabular-nums; }
  .stat .label { font-size: 72px; font-weight: 800; }
  .price { font-size: 250px; font-weight: 900; line-height: 1; letter-spacing: -6px; color: ${accent}; font-variant-numeric: tabular-nums; text-shadow: 0 10px 60px rgba(0,0,0,.6); }
  .sub { font-size: 42px; font-weight: 600; color: rgba(255,255,255,.85); }
  .follow { font-size: 54px; font-weight: 900; color: #1F1D18; background: ${accent}; padding: 22px 44px; border-radius: 999px; }
  .steps { position: absolute; left: 70px; right: 70px; top: 520px; display: grid; gap: 30px; }
  .step { display: flex; align-items: center; gap: 34px; padding: 10px 20px; }
  .step .txt { text-shadow: 0 6px 30px rgba(0,0,0,.7); }
  .step .no { flex: none; width: 120px; height: 120px; border-radius: 50%; background: ${accent}; color: #1F1D18; font-size: 72px; font-weight: 900; display: flex; align-items: center; justify-content: center; }
  .step .txt { font-size: 60px; font-weight: 800; line-height: 1.1; text-align: left; }
  .curve { position: absolute; left: 70px; right: 70px; top: 500px; height: 560px; display: grid; grid-template-columns: repeat(8, 1fr); gap: 14px; align-items: end; }
  .curve .col { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
  .curve .cnt { font-size: 40px; font-weight: 800; margin-bottom: 10px; font-variant-numeric: tabular-nums; }
  .curve .bar { width: 100%; height: 0; border-radius: 14px 14px 4px 4px; background: linear-gradient(180deg, ${accent}, ${accent}99); }
  .curve .mv { margin-top: 14px; font-size: 38px; font-weight: 800; color: rgba(255,255,255,.75); }
  .split { position: absolute; left: 70px; right: 70px; top: 1150px; display: flex; flex-wrap: wrap; justify-content: center; gap: 14px 34px; font-size: 40px; color: rgba(255,255,255,.85); }
  .split b { color: #fff; font-weight: 900; }
  .priciest { display: flex; align-items: center; gap: 34px; margin-top: 30px; padding: 0 20px; text-align: left; text-shadow: 0 6px 30px rgba(0,0,0,.7); }
  .card.pcard { width: 230px; box-shadow: 0 20px 50px rgba(0,0,0,.5); }
  .plabel { font-size: 28px; font-weight: 800; letter-spacing: 4px; color: ${accent}; }
  .pname { font-size: 52px; font-weight: 900; line-height: 1.05; margin: 8px 0; max-width: 560px; }
  .pval { font-size: 46px; font-weight: 700; color: rgba(255,255,255,.85); }
  /* Sichere Zone: Instagram legt oben ~210 px (Kopfzeile), unten ~480 px (Name, Caption,
     Audio) und rechts die Buttons ueber das Video. Alle Inhalte liegen deshalb auf einer
     Buehne, die auf 85 % verkleinert und nach unten versetzt ist: y 100..1540 -> ~207..1431. */
  ${styleCss(accent)}
  #progress { position: absolute; top: 125px; left: 70px; right: 70px; display: flex; gap: 10px; }
  #progress div { flex: 1; height: 8px; border-radius: 4px; background: rgba(255,255,255,.25); overflow: hidden; }
  #progress i { display: block; height: 100%; width: 0; background: #fff; }
</style></head><body>
  <div id="bg"></div><div id="glow"></div><div id="shade"></div>
  <div id="stage">
  <div id="progress">${beats.map(() => "<div><i></i></div>").join("")}</div>
  ${beats.map((b) => beatHtml(b, deck, s)).join("\n")}
  </div>
  ${STYLE_HTML}
<script>
  const TOTAL = ${total};
  const BEATS = ${JSON.stringify(beats.map((b) => ({ start: b.start, dur: b.dur, cap: b.say, voice: b.voiceSec })))};
  const IMPACTS = ${JSON.stringify(impacts)};
  ${STYLE_JS}
  const bars = [...document.querySelectorAll("#progress i")];
  const bg = document.getElementById("bg");
  const glow = document.getElementById("glow");

  window.renderAt = (t) => {
    // Hintergrund: langsamer Ken-Burns ueber das ganze Video, Glow wandert
    const g = t / TOTAL;
    bg.style.transform = "scale(" + (1.18 - 0.14 * g) + ") translateY(" + (-30 * g) + "px)";
    glow.style.transform = "translate(" + (Math.sin(t * 0.6) * 90) + "px," + (Math.cos(t * 0.45) * 120) + "px)";
    BEATS.forEach((b, i) => { bars[i].style.width = (clamp((t - b.start) / b.dur) * 100) + "%"; });
    const shown = styleFrame(t, ${subtitles});
    if (!shown) return;
    const { sec, i: si, lt: lt0 } = shown;
    const lt = si === 0 ? lt0 + 0.35 : lt0;
    {
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
  const voices = await synthesizeVoices(
    script.beats.map((b) => speakable(b.say)),
    jobDir,
    "reel-voice-",
    (s, p) => report(`Reel: ${s}`, p)
  );
  const withVoice = voices.some(Boolean);

  // 2. Zeitachse: Szene so lang wie Mindestdauer bzw. Satz + Luft
  let t = 0;
  const beats: TimedBeat[] = script.beats.map((b, i) => {
    const v = voices[i];
    const dur = Math.max(b.base, v ? v.seconds + 0.3 : 0);
    const tb = { ...b, start: t, dur, voiceSec: v ? v.seconds : 0 };
    t += dur;
    return tb;
  });
  const total = t;
  const frames = Math.round(total * FPS);

  // 3. ffmpeg vorbereiten: Bilder kommen per Pipe, Ton als Datei(en)
  const out = path.join(jobDir, "reel.mp4");
  // Soundeffekte + Untermalung (im Code erzeugt), Musik unter der Stimme geduckt
  const { cues, impacts, resolveAt } = deckCues(beats, script);
  const sfxFile = path.join(jobDir, "reel-sfx.wav");
  const musicFile = path.join(jobDir, "reel-music.wav");
  buildSoundtrack(cues, total, resolveAt, sfxFile, musicFile);
  const spoken = voices.flatMap((v, i) => (v ? [{ file: v.file, at: beats[i].start + 0.1 }] : []));
  const args = ["-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", ...audioArgs(sfxFile, musicFile, spoken, total)];
  args.push(
    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", out
  );

  // spawnFfmpeg: Abbruch fuehrt nie zu einer unbehandelten Ablehnung (Server-Absturz)
  const { proc: ff, done: ffDone } = spawnFfmpeg(ffmpegPath, args);

  // 4. Seite rendern und Bild fuer Bild aufnehmen
  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.setContent(pageHtml(deck, script, beats, total, withVoice || Boolean(opts.subtitles), impacts), { waitUntil: "networkidle0", timeout: 90_000 });
    await page.evaluate("window.assetsReady()");
    report("Reel: lade Kartenbilder", 0.08);
    const coverFrame = Math.min(frames - 1, Math.round(1.8 * FPS));
    for (let f = 0; f < frames; f++) {
      if (f % 15 === 0) report(`Reel: rendere Bild ${f + 1} von ${frames}`, 0.1 + 0.85 * (f / frames));
      await page.evaluate(`window.renderAt(${(f / FPS).toFixed(4)})`);
      const buf = (await page.screenshot({ type: "jpeg", quality: 90 })) as Buffer;
      // Titelbild aus der Hook-Szene (Vorschau in der App + Reel-Cover bei Instagram)
      if (f === coverFrame) fs.writeFileSync(reelCoverPath(out), buf);
      if (!ff.stdin!.write(buf)) await new Promise((r) => ff.stdin!.once("drain", r));
    }
  } catch (err) {
    ff.kill("SIGKILL");
    throw err;
  } finally {
    ff.stdin!.end();
    if (browser) await browser.close();
  }
  report("Reel: Video wird fertig kodiert", 0.96);
  await ffDone;
  voices.forEach((v) => v && fs.rmSync(v.file, { force: true }));
  [sfxFile, musicFile].forEach((f) => fs.rmSync(f, { force: true }));
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
/** Ob eine Sprachausgabe (Piper oder Dia) konfiguriert ist */
export function ttsEnabled(): boolean {
  return diaEnabled() || voiceStudioEnabled() || Boolean(config.piperBin && config.piperModel);
}

function voiceStudioEnabled(): boolean {
  return config.ttsEngine === "voicestudio";
}

/**
 * VoiceStudio (github.com/debpalash/VoiceStudio): eigener Dienst (Docker) auf dem
 * Server, OpenAI-kompatibel. Ein Aufruf pro Szene.
 *
 * Gleiche Stimme ueberall: Mit voice "default" erfindet das Modell bei jeder
 * Anfrage eine neue Stimme (klingt wie zwei Sprecher im Wechsel). Deshalb legt
 * das Tool beim ersten Mal ein festes Stimmprofil an (Probeaufnahme mit festem
 * Seed als Referenz) und spricht danach jede Szene mit diesem Profil.
 */
const VS_PROFILE = "floating-mana-narrator";
const VS_SAMPLE =
  "Hey, welcome back. Today I want to show you something I really love, so let's take a look at how it all works together.";
let vsVoiceCache: string | null = null;

const vsBase = () => config.voiceStudioUrl.replace(/\/+$/, "");
const vsAuth = (): Record<string, string> => (config.voiceStudioApiKey ? { Authorization: `Bearer ${config.voiceStudioApiKey}` } : {});

async function vsSpeech(input: string, voice: string, extra: Record<string, unknown> = {}): Promise<Buffer> {
  const res = await fetch(`${vsBase()}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...vsAuth() },
    body: JSON.stringify({
      model: config.voiceStudioModel,
      voice,
      input,
      response_format: "wav",
      speed: config.voiceStudioSpeed,
      language: "en",
      // Seed nur ohne Profil; ein Profil bringt seinen eigenen (sonst klaenge der Archetyp anders)
      ...(voice === "default" ? { seed: config.voiceStudioSeed } : {}),
      ...(config.voiceStudioInstructions ? { instructions: config.voiceStudioInstructions } : {}),
      ...extra,
    }),
    signal: AbortSignal.timeout(config.voiceStudioTimeoutSec * 1000),
  });
  if (!res.ok) throw new Error(`VoiceStudio ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Feste Stimme: Archetyp (z. B. feat_17_the_commentator), Profil-ID/-Name oder automatisches Profil */
async function voiceStudioVoice(): Promise<string> {
  if (vsVoiceCache) return vsVoiceCache;
  const set = (config.voiceStudioVoice || "").trim();
  try {
    const list = (await (await fetch(`${vsBase()}/profiles`, { headers: vsAuth() })).json()) as { id?: string; name?: string }[];
    const profiles = Array.isArray(list) ? list : [];
    if (set && set.toLowerCase() !== "default") {
      // Archetyp aus der VoiceStudio-Galerie? Dann einmal als Klon-Profil festhalten
      const arch = await fetch(`${vsBase()}/archetypes/${encodeURIComponent(set)}`, { headers: vsAuth() });
      if (!arch.ok) return (vsVoiceCache = set); // normale Profil-ID oder -Name
      const name = `floating-mana-${set}`;
      const hit = profiles.find((p) => p.name === name);
      if (hit) return (vsVoiceCache = hit.id ?? name);
      const a = (await arch.json()) as { sample_script?: string; name?: string };
      try {
        const prev = await fetch(`${vsBase()}/archetypes/${encodeURIComponent(set)}/preview?local=true`, {
          headers: vsAuth(),
          signal: AbortSignal.timeout(config.voiceStudioTimeoutSec * 1000),
        });
        if (!prev.ok || !a.sample_script) throw new Error(`Hoerprobe ${prev.status}`);
        const created = await vsCreateProfile(name, Buffer.from(await prev.arrayBuffer()), a.sample_script);
        console.log(`[tts] VoiceStudio: Stimme "${set}" als Profil "${name}" festgehalten (${created})`);
        return (vsVoiceCache = created);
      } catch (err) {
        // Fallback: Archetyp direkt als Design-Profil uebernehmen (fester Seed im Profil)
        const use = await fetch(`${vsBase()}/archetypes/${encodeURIComponent(set)}/use?name=${encodeURIComponent(name)}`, { method: "POST", headers: vsAuth() });
        if (!use.ok) throw new Error(`Archetyp uebernehmen: ${use.status} (${err instanceof Error ? err.message : err})`);
        const r = (await use.json()) as { profile_id?: string };
        console.log(`[tts] VoiceStudio: Archetyp "${set}" als Design-Profil uebernommen (${r.profile_id})`);
        return (vsVoiceCache = r.profile_id ?? name);
      }
    }
    // Keine Stimme gesetzt: eigenes Profil aus einer Probeaufnahme mit festem Seed
    const hit = profiles.find((p) => p.name === VS_PROFILE);
    if (hit) return (vsVoiceCache = hit.id ?? VS_PROFILE);
    let wav: Buffer;
    try {
      wav = await vsSpeech(VS_SAMPLE, "default", { instruct: config.voiceStudioVoiceDesign });
    } catch {
      wav = await vsSpeech(VS_SAMPLE, "default");
    }
    const created = await vsCreateProfile(VS_PROFILE, wav, VS_SAMPLE);
    console.log(`[tts] VoiceStudio-Stimmprofil "${VS_PROFILE}" angelegt (${created})`);
    return (vsVoiceCache = created);
  } catch (err) {
    console.warn(`[tts] VoiceStudio: kein festes Stimmprofil (${err instanceof Error ? err.message : err}), nutze ${set || "default"} + Seed`);
    return set || "default";
  }
}

async function vsCreateProfile(name: string, audio: Buffer, refText: string): Promise<string> {
  const form = new FormData();
  form.append("name", name);
  form.append("ref_audio", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "voice.wav");
  form.append("ref_text", refText);
  form.append("seed", String(config.voiceStudioSeed));
  form.append("kind", "clone");
  const res = await fetch(`${vsBase()}/profiles`, { method: "POST", headers: vsAuth(), body: form });
  if (!res.ok) throw new Error(`Profil anlegen: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const created = (await res.json()) as { id?: string };
  return created.id ?? name;
}

async function synthesizeVoiceStudio(
  texts: string[],
  dir: string,
  prefix: string,
  report: (step: string, p?: number) => void
): Promise<({ file: string; seconds: number } | null)[]> {
  const out: ({ file: string; seconds: number } | null)[] = [];
  report("Sprachaufnahme (VoiceStudio): Stimme wird geladen", 0);
  const voice = await voiceStudioVoice();
  for (let i = 0; i < texts.length; i++) {
    report(`Sprachaufnahme (VoiceStudio) ${i + 1}/${texts.length}`, (i / texts.length) * 0.08);
    if (!texts[i]) {
      out.push(null);
      continue;
    }
    const file = path.join(dir, `${prefix}${i}.wav`);
    fs.writeFileSync(file, await vsSpeech(texts[i], voice));
    out.push({ file, seconds: await wavSeconds(file) });
  }
  return out;
}

function diaEnabled(): boolean {
  return config.ttsEngine === "dia";
}

async function wavSeconds(file: string): Promise<number> {
  const probe = await run(ffmpegPath!, ["-i", file], { maxBuffer: 8 * 1024 * 1024 }).catch(
    (e: { stderr?: string }) => ({ stderr: e.stderr ?? "" })
  );
  const m = String(probe.stderr).match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]) : 3;
}

/**
 * Alle Saetze eines Reels vertonen. Mit TTS_ENGINE=dia laedt Nari Labs Dia
 * das Modell einmal und spricht alle Szenen mit derselben Stimme
 * (scripts/dia_tts.py). Scheitert Dia (fehlt, zu langsam, zu wenig RAM),
 * uebernimmt Piper, damit das Reel trotzdem fertig wird.
 */
export async function synthesizeVoices(
  texts: string[],
  dir: string,
  prefix: string,
  report: (step: string, p?: number) => void = () => undefined
): Promise<({ file: string; seconds: number } | null)[]> {
  if (!ttsEnabled() || !ffmpegPath) return texts.map(() => null);
  if (voiceStudioEnabled()) {
    try {
      return await synthesizeVoiceStudio(texts, dir, prefix, report);
    } catch (err) {
      console.warn(`[tts] VoiceStudio fehlgeschlagen, nutze Piper: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (diaEnabled()) {
    try {
      return await synthesizeDia(texts, dir, prefix, report);
    } catch (err) {
      console.warn(`[tts] Dia fehlgeschlagen, nutze Piper: ${err instanceof Error ? err.message : err}`);
    }
  }
  const out: ({ file: string; seconds: number } | null)[] = [];
  for (let i = 0; i < texts.length; i++) {
    report(`Sprachaufnahme ${i + 1}/${texts.length}`, (i / texts.length) * 0.08);
    out.push(await synthesizeVoice(texts[i], dir, `${prefix}${i}.wav`));
  }
  return out;
}

async function synthesizeDia(
  texts: string[],
  dir: string,
  prefix: string,
  report: (step: string, p?: number) => void
): Promise<({ file: string; seconds: number } | null)[]> {
  const jobFile = path.join(dir, `${prefix}dia-job.json`);
  fs.writeFileSync(
    jobFile,
    JSON.stringify({ texts, outDir: dir, prefix, voicePrompt: config.diaVoicePrompt || null, seed: config.diaSeed })
  );
  const script = path.join(__dirname, "..", "..", "scripts", "dia_tts.py");
  report(`Sprachaufnahme (Dia) 0/${texts.length}, Modell lädt …`, 0);
  const { proc, done } = spawnFfmpeg(config.diaPython, [script, jobFile]);
  let n = 0;
  proc.stdout?.on("data", (d) => {
    n += (String(d).match(/^OK \d+/gm) ?? []).length;
    report(`Sprachaufnahme (Dia) ${n}/${texts.length}`, (n / texts.length) * 0.08);
  });
  const timer = setTimeout(() => proc.kill("SIGKILL"), config.diaTimeoutMin * 60_000);
  try {
    await done;
  } finally {
    clearTimeout(timer);
    fs.rmSync(jobFile, { force: true });
  }
  const out: ({ file: string; seconds: number } | null)[] = [];
  for (let i = 0; i < texts.length; i++) {
    const file = path.join(dir, `${prefix}${i}.wav`);
    out.push(texts[i] && fs.existsSync(file) ? { file, seconds: await wavSeconds(file) } : null);
  }
  if (!out.some(Boolean)) throw new Error("Dia hat keine Audiodateien erzeugt");
  return out;
}

export async function synthesizeVoice(
  text: string,
  jobDir: string,
  fileName: string
): Promise<{ file: string; seconds: number } | null> {
  if (!config.piperBin || !config.piperModel || !ffmpegPath || !text) return null;
  const file = path.join(jobDir, fileName);
  {
    await new Promise<void>((resolve, reject) => {
      const p = spawn(config.piperBin, ["--model", config.piperModel, "--output_file", file, "--sentence_silence", String(config.piperSentenceSilence), "--length_scale", String(config.piperLengthScale)]);
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
