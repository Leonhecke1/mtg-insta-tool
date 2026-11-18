import * as fs from "fs";
import * as path from "path";
import { config } from "../config";
import { cardImages, scryfall } from "../news/news";
import seedJson from "./seed.json";

/**
 * Commander Spellbook (commanderspellbook.com): oeffentliche, kostenlose API mit
 * allen bekannten Combos. Liefert Karten, Schritte, Ergebnis, Voraussetzungen,
 * Preis und Bracket. Kartenbilder und Oracle-Text kommen von Scryfall.
 */

const UA = "mtg-insta-tool/0.1 (+https://github.com/)";
const API = "https://backend.commanderspellbook.com";

export interface ComboCard {
  name: string;
  shortName: string;
  image?: string;
  art?: string;
  oracle: string;
  typeLine: string;
  colors: string[];
  /** Satz aus dem Kartentext, der fuer die Combo zaehlt */
  keyText?: string;
}

export interface Combo {
  id: string;
  url: string;
  cards: ComboCard[];
  results: string[];
  steps: string[];
  prerequisites: string[];
  priceEur: number | null;
  bracketTag?: string;
  identity: string;
  popularity: number;
}

/** "https://commanderspellbook.com/combo/880-6529-6664/" oder "880-6529-6664" -> ID */
export function comboIdFrom(input: string): string | null {
  const m = input.trim().match(/(?:combo\/)?(\d+(?:-\d+)*(?:--\d+)?)\/?\s*$/);
  return m ? m[1] : null;
}

/** Fehler, bei dem der lokale Vorrat (seed.json) einspringen darf */
class SpellbookUnavailable extends Error {}

async function spellbook<T = any>(pathAndQuery: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${pathAndQuery}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
  } catch (err) {
    throw new SpellbookUnavailable(`Commander Spellbook nicht erreichbar: ${err instanceof Error ? err.message : err}`);
  }
  const text = await res.text();
  let body: any = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* HTML-Fehlerseite */
  }
  if (res.status === 404) throw new Error("Combo auf Commander Spellbook nicht gefunden");
  if (!res.ok) {
    const why = body?.detail ?? text.replace(/<[^>]+>/g, " ").replace(/s+/g, " ").trim().slice(0, 160);
    console.warn(`[combo] Commander Spellbook ${res.status} fuer ${pathAndQuery.slice(0, 80)}: ${why}`);
    // 403/429/5xx: z. B. Sperre fuer Server-IPs -> lokaler Vorrat
    throw new SpellbookUnavailable(`Commander Spellbook ${res.status}${why ? `: ${why}` : ""}`);
  }
  return body as T;
}

/**
 * Lokaler Vorrat: ~500 beliebte Combos (2-3 Karten, Commander-legal, <= 40 EUR),
 * gleiches Format wie die API. Springt ein, wenn Spellbook den Server blockt.
 * Neu erzeugen: siehe README ("Combo-Vorrat aktualisieren").
 */
const SEED: any[] = seedJson as any[];

/** Karten, die automatisch gewaehlte Combos nicht enthalten duerfen */
const EXCLUDED_CARDS = ["Sol Ring"];

const shortName = (n: string) => n.split(" // ")[0].split(",")[0].trim();
const stripReminder = (t: string) => t.replace(/\([^)]*\)/g, "").replace(/[ \t]+/g, " ").trim();

/** Satz aus dem Oracle-Text, der die meisten Woerter mit den Combo-Schritten teilt */
function keySentence(oracle: string, steps: string[], cardName = ""): string | undefined {
  // grober Wortstamm: "lands"/"land", "untapped"/"untap", "creating"/"create"
  const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "");
  const words = (s: string) => new Set((s.toLowerCase().match(/[a-z]{4,}/g) ?? []).map(stem));
  // nur Schritte, die diese Karte erwaehnen (sonst alle)
  const short = shortName(cardName).toLowerCase();
  const mine = steps.filter((s) => short && s.toLowerCase().includes(short));
  const stepWords = words((mine.length ? mine : steps).join(" ").toLowerCase().split(short).join(" "));
  const sentences = stripReminder(oracle)
    // ganze Faehigkeiten (Zeilen), sonst entstehen Bruchstuecke wie "If you do, ..."
    .split(/\n/)
    .map((x) => x.trim())
    .filter((x) => x.length > 12);
  let best: { s: string; score: number } | undefined;
  for (const s of sentences) {
    const score = [...words(s)].filter((w) => stepWords.has(w)).length;
    if (!best || score > best.score) best = { s, score };
  }
  return best?.s;
}

function toCombo(v: any, cards: ComboCard[]): Combo {
  const steps = String(v.description ?? "")
    .split("\n")
    .map((l: string) => l.trim())
    .filter(Boolean);
  const prereq = [v.easyPrerequisites, v.notablePrerequisites]
    .flatMap((p: string | undefined) => String(p ?? "").split("\n"))
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    id: v.id,
    url: `https://commanderspellbook.com/combo/${v.id}/`,
    cards: cards.map((c) => ({ ...c, keyText: keySentence(c.oracle, steps, c.name) })),
    results: (v.produces ?? []).map((p: any) => p.feature?.name).filter(Boolean),
    steps,
    prerequisites: prereq,
    priceEur: v.prices?.cardmarket ? Number(v.prices.cardmarket) : null,
    bracketTag: v.bracketTag,
    identity: v.identity ?? "",
    popularity: v.popularity ?? 0,
  };
}

/** Kartendaten (Bild, Oracle) gesammelt in EINER Scryfall-Anfrage */
async function loadCards(names: string[]): Promise<ComboCard[]> {
  const r: any = await scryfall("https://api.scryfall.com/cards/collection", {
    method: "POST",
    body: { identifiers: names.map((name) => ({ name })) },
  });
  const byName = new Map<string, any>((r.data ?? []).map((c: any) => [c.name, c]));
  return names.map((name) => {
    const c = byName.get(name) ?? [...byName.values()].find((x: any) => x.name.startsWith(name));
    const oracleText = c?.oracle_text ?? c?.card_faces?.map((f: any) => f.oracle_text).join("\n") ?? "";
    return {
      name,
      shortName: shortName(name),
      ...(c ? cardImages(c) : {}),
      oracle: oracleText,
      typeLine: c?.type_line ?? "",
      colors: c?.color_identity ?? [],
    };
  });
}

export async function fetchCombo(idOrUrl: string): Promise<Combo> {
  const id = comboIdFrom(idOrUrl);
  if (!id) throw new Error("Bitte einen Commander-Spellbook-Link oder eine Combo-ID angeben");
  let v: any;
  try {
    v = await spellbook(`/variants/${encodeURIComponent(id)}/`);
  } catch (err) {
    if (!(err instanceof SpellbookUnavailable)) throw err;
    v = SEED.find((x) => x.id === id);
    if (!v) throw new Error(`${err.message}. Diese Combo ist nicht im lokalen Vorrat, Feld leer lassen für eine automatische Combo.`);
    console.warn(`[combo] ${id} aus dem lokalen Vorrat`);
  }
  const names: string[] = (v.uses ?? []).map((u: any) => u.card?.name).filter(Boolean);
  return toCombo(v, await loadCards(names));
}

// --- automatische Auswahl ---

const postedFile = () => path.join(config.dataDir, "combos-posted.json");
function posted(): string[] {
  try {
    return JSON.parse(fs.readFileSync(postedFile(), "utf8"));
  } catch {
    return [];
  }
}
export function markComboUsed(id: string): void {
  const list = [...new Set([...posted(), id])];
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(postedFile(), JSON.stringify(list));
}

/**
 * Beliebte, gut erklaerbare Combo, die noch nicht verwendet wurde:
 * 2-3 Karten, Commander-legal, bezahlbar. Kartennamen-Paare werden nicht
 * doppelt genommen (Spellbook hat viele Varianten derselben Combo).
 */
export async function pickCombo(maxPriceEur: number): Promise<Combo> {
  const used = new Set(posted());
  const q = `cards<=3 legal:commander price<=${Math.round(maxPriceEur)}`;
  const pages: (() => Promise<any[]>)[] = [0, 50, 100, 150].map((offset) => async () =>
    (await spellbook<any>(`/variants/?q=${encodeURIComponent(q)}&ordering=-popularity&limit=50&offset=${offset}`)).results ?? []
  );
  // Fallback: lokaler Vorrat, nach Beliebtheit sortiert und im Budget
  const fromSeed = async () =>
    SEED.filter((v) => v.prices?.cardmarket == null || Number(v.prices.cardmarket) <= maxPriceEur).sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
  let usingSeed = false;
  for (let i = 0; i < pages.length; i++) {
    let results: any[];
    try {
      results = usingSeed ? [] : await pages[i]();
    } catch (err) {
      if (!(err instanceof SpellbookUnavailable)) throw err;
      console.warn(`[combo] ${err.message} -> lokaler Vorrat`);
      usingSeed = true;
      results = await fromSeed();
      i = pages.length; // nach dem Vorrat nicht weiter blaettern
    }
    for (const v of results) {
      const names = (v.uses ?? []).map((u: any) => u.card?.name).sort().join("+");
      if (used.has(v.id) || used.has(names)) continue;
      // Sol Ring gehoert fuer floating.mana verboten, also auch nicht in Combos
      if (EXCLUDED_CARDS.some((x) => names.split("+").includes(x))) continue;
      // Max. Bracket 3: keine "Ruthless"- (R, cEDH) und "Powerful"-Combos (P) automatisch
      if (["R", "P"].includes(v.bracketTag)) continue;
      if (!(v.description ?? "").trim() || !(v.produces ?? []).length) continue;
      used.add(names);
      return toCombo(v, await loadCards((v.uses ?? []).map((u: any) => u.card?.name)));
    }
  }
  throw new Error("Keine passende neue Combo gefunden");
}

/** Auch Kartennamen-Kombination merken, damit Varianten nicht wiederkommen */
export function markComboPosted(c: Combo): void {
  markComboUsed(c.id);
  markComboUsed(c.cards.map((x) => x.name).sort().join("+"));
}
