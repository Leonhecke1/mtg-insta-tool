import { Deck } from "../types";
import { analyzeDeck, cardRole, shortName } from "../llm/fallback";
import { formatEur } from "../render/components";
import { humanize } from "./human";
import { lintCaption, CaptionLint } from "./caption";

/**
 * Caption nach dem Schema von /ig-caption:
 *  - Zeile 1 (sichtbar vor dem "... mehr", <= 125 Zeichen):
 *      Carousel = der Hook (konkret, Zahl + Name)
 *      Reel     = das Reel hat den Hook schon, die Zeile ist die Aufforderung
 *  - kurze Absaetze mit den Suchbegriffen (Commander-Name, "commander deck" ...)
 *  - genau EINE Aufforderung
 *  - hoechstens 5 Hashtags, unten
 *  - kein Link in der Caption -> Archidekt-Link kommt als erster Kommentar
 * Danach laeuft /ig-human darueber (Kartennamen bleiben geschuetzt).
 */

export interface IgCaption {
  caption: string;
  firstComment: string | null;
  keywords: string[];
  lint: CaptionLint;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}
const pick = <T>(arr: T[], seed: string): T => arr[hash(seed) % arr.length];

const ARCHETYPE_TAG: Record<string, string> = {
  tokens: "#tokens", counters: "#plusonecounters", graveyard: "#reanimator", aristocrats: "#aristocrats",
  spellslinger: "#spellslinger", artifacts: "#artifacts", enchantress: "#enchantress", landfall: "#landfall",
  blink: "#blink", lifegain: "#lifegain", voltron: "#voltron", dragons: "#dragons",
};

const tagify = (s: string) => "#" + s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");

export function igCaption(
  deck: Deck,
  opts: { kind: "carousel" | "reel" | "image"; archidektUrl?: string; creditUser?: string }
): IgCaption {
  const a = analyzeDeck(deck);
  const fullName = deck.commanders.map((c) => c.name).join(" & ");
  const price = formatEur(a.priceEur).replace(/\.00$/, "");
  const seed = fullName;

  // --- Zeile 1 ---
  const engine = a.engine ?? "grinds out value every turn";
  const hooks = [
    `${a.name} ${engine}, and the whole deck costs ${price}.`,
    `${price} for a ${a.combo} deck that ${engine}.`,
    `${a.cardCount} cards, ${price}, and ${a.name} ${engine}.`,
  ];
  const ask = "What would you swap first? Tell me in the comments.";
  let line1 = opts.kind === "reel" ? `${ask.split("?")[0]}? ${a.name}, ${a.combo}, ${price}.` : pick(hooks, seed);
  if (line1.length > 125) line1 = `${a.name} ${engine}. ${price}.`.slice(0, 125);

  // --- Koerper: Suchbegriffe als normale Saetze ---
  // Nur der erste Satz der wichtigsten Faehigkeit, hoechstens ~140 Zeichen
  const firstSentence = (a.abilities[0] ?? "").split(/(?<=\.)\s/)[0].replace(/\.$/, "");
  const ability = firstSentence.length > 140 ? firstSentence.slice(0, 137).replace(/\s+\S*$/, "") + " …" : firstSentence;
  const article = /^[AEIOU]/i.test(a.combo) ? "An" : "A";
  const p1 = `${article} ${a.combo} ${a.style} commander deck built around ${fullName}.${ability ? ` ${ability}.` : ""}`;
  const p2 = a.keyCards.length
    ? `Key pieces: ${a.keyCards.map((c) => `${shortName(c.name.split(" // ")[0])} ${cardRole(c)}`).join(", ")}.`
    : "";
  const statBits = [
    a.stats.ramp >= 3 ? `${a.stats.ramp} ramp` : null,
    a.stats.draw >= 3 ? `${a.stats.draw} draw` : null,
    a.stats.removal >= 2 ? `${a.stats.removal} removal` : null,
  ].filter(Boolean);
  // Preis/Kartenanzahl nur, wenn Zeile 1 sie nicht schon nennt
  const priceInLine1 = line1.includes(price);
  const p3 = `${statBits.length ? `${statBits.join(", ")}, ` : ""}average mana value ${a.avgManaValue.toFixed(1)}.${priceInLine1 ? "" : ` ${a.cardCount} cards, ${price} on Cardmarket.`}`;
  const credit = opts.creditUser ? `Deck built by ${opts.creditUser} on Archidekt, all credit to them.` : "";
  const listHint = opts.archidektUrl ? "Full decklist in the first comment." : "";

  // --- genau eine Aufforderung (beim Reel steht sie schon in Zeile 1) ---
  const askLine = opts.kind === "reel" ? "" : ask;

  // --- max. 5 Hashtags, spezifisch ---
  const tags = [...new Set(
    ["#edh", "#mtgcommander", tagify(deck.commanders[0]?.name ?? a.name), a.archetypeId ? ARCHETYPE_TAG[a.archetypeId] : tagify(a.combo)]
      .filter((t): t is string => Boolean(t) && t !== "#")
  )].slice(0, 5);

  const raw = [line1, p1, p2, p3, credit, listHint, askLine, tags.join(" ")].filter(Boolean).join("\n\n");

  // /ig-human: Floskeln, Gedankenstriche, unsichtbare Zeichen raus; Kartennamen schuetzen
  const cardNames = [...deck.commanders, ...deck.mainboard].map((c) => c.name);
  const caption = humanize(raw, cardNames).text;

  const firstComment = opts.archidektUrl
    ? `Full decklist: ${opts.archidektUrl}${opts.creditUser ? ` (built by ${opts.creditUser})` : ""}`
    : null;
  const keywords = [fullName, "commander deck", a.combo];
  return { caption, firstComment, keywords, lint: lintCaption(caption, keywords) };
}

/** Credit aus einem bestehenden Caption-Text lesen ("Deck by X on Archidekt") */
export function creditFromText(text: string | undefined): string | undefined {
  return text?.match(/Deck by (\S+) on Archidekt/)?.[1];
}
