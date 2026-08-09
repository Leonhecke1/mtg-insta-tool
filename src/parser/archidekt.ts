import { CardFallbackData, ColorCode, RawCardRef, RawDeckList } from "../types";
import { scryfallCdnImageUrl } from "../scryfall/client";

/**
 * Archidekts API ist wie Moxfields inoffiziell/undokumentiert. Deck-Daten
 * kommen als eine flache "cards"-Liste (kein "boards"-Wrapper wie bei
 * Moxfield) - Board-Zugehoerigkeit (Commander/Maybeboard/Sideboard) wird
 * ueber die "categories" jeder Karte ausgedrueckt. Falls Archidekt das
 * Format aendert: hier ansetzen.
 *
 * card.oracleCard enthaelt Manakosten/Text/Farbidentitaet (volle Farbnamen,
 * nicht Buchstaben-Codes), card.prices.cm ist der Cardmarket-Preis, und
 * card.uid ist die Scryfall-Card-UUID (fuer Bild-URL-Konstruktion ohne
 * Scryfall-API-Aufruf) - alles verifiziert gegen eine echte Deck-Response.
 * Wird als Fallback mitgegeben, falls Scryfalls eigene API mal nicht
 * antwortet (siehe scryfall/enrich.ts).
 */

const COLOR_NAME_TO_CODE: Record<string, ColorCode> = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
};

interface ArchidektOracleCard {
  name?: string;
  colorIdentity?: string[];
  manaCost?: string;
  text?: string;
  types?: string[];
  subTypes?: string[];
  superTypes?: string[];
}

interface ArchidektCard {
  name?: string;
  uid?: string;
  prices?: { cm?: number | null };
  oracleCard?: ArchidektOracleCard;
}

interface ArchidektCardEntry {
  quantity?: number;
  categories?: string[];
  category?: string;
  card?: ArchidektCard;
}

export function extractArchidektId(input: string): string {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  // https://archidekt.com/decks/{id}/{slug}  oder  https://archidekt.com/decks/{id}
  const match = trimmed.match(/decks\/(\d+)/);
  if (!match) {
    throw new Error(`Konnte Archidekt-Deck-ID nicht aus "${input}" extrahieren`);
  }
  return match[1];
}

function cardName(entry: ArchidektCardEntry): string | undefined {
  return entry.card?.oracleCard?.name ?? entry.card?.name;
}

function categoriesOf(entry: ArchidektCardEntry): string[] {
  if (Array.isArray(entry.categories) && entry.categories.length > 0) {
    return entry.categories.map((c) => c.toLowerCase());
  }
  if (entry.category) return [entry.category.toLowerCase()];
  return [];
}

function typeLineOf(oracle: ArchidektOracleCard | undefined): string {
  if (!oracle) return "";
  const supers = oracle.superTypes ?? [];
  const types = oracle.types ?? [];
  const subs = oracle.subTypes ?? [];
  const head = [...supers, ...types].join(" ");
  return subs.length > 0 ? `${head} — ${subs.join(" ")}` : head;
}

function buildFallback(card: ArchidektCard | undefined): CardFallbackData {
  const oracle = card?.oracleCard;
  const colorIdentity = (oracle?.colorIdentity ?? [])
    .map((c) => COLOR_NAME_TO_CODE[c.toLowerCase()])
    .filter((c): c is ColorCode => !!c);

  return {
    manaCost: oracle?.manaCost || "",
    typeLine: typeLineOf(oracle),
    oracleText: oracle?.text || "",
    colorIdentity,
    imageNormal: card?.uid ? scryfallCdnImageUrl(card.uid) : null,
    priceEur: card?.prices?.cm ?? null,
  };
}

export async function fetchArchidektDeck(urlOrId: string): Promise<RawDeckList> {
  const deckId = extractArchidektId(urlOrId);
  const apiUrl = `https://archidekt.com/api/decks/${deckId}/`;

  // Bewusst native fetch statt axios - siehe scryfall/client.ts fuer den
  // Hintergrund (axios wurde von manchen Cloudflare-Edges geblockt).
  const res = await fetch(apiUrl, {
    headers: {
      "User-Agent": "mtg-insta-tool/0.1 (+https://github.com/)",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`Archidekt ${res.status} bei ${apiUrl}: ${bodyText.slice(0, 300)}`);
  }
  const data = (await res.json()) as { cards?: ArchidektCardEntry[] };

  const entries = Array.isArray(data.cards) ? data.cards : [];
  if (entries.length === 0) {
    throw new Error(
      "Keine Karten im Archidekt-Deck gefunden - Response-Format hat sich moeglicherweise geaendert (cards[])"
    );
  }

  let commander: RawCardRef | undefined;
  const mainboard: RawCardRef[] = [];
  const maybeboard: RawCardRef[] = [];

  for (const entry of entries) {
    const name = cardName(entry);
    if (!name) continue;
    const quantity = entry.quantity ?? 1;
    const categories = categoriesOf(entry);
    const fallback = buildFallback(entry.card);

    if (categories.includes("commander")) {
      commander = { name, quantity: 1, fallback };
      continue;
    }
    if (categories.includes("sideboard")) {
      continue; // wie bei Moxfield: fuer EDH-Deck-Techs nicht relevant
    }
    if (categories.includes("maybeboard") || categories.includes("maybe board")) {
      maybeboard.push({ name, quantity, fallback });
      continue;
    }
    mainboard.push({ name, quantity, fallback });
  }

  if (!commander) {
    throw new Error(
      'Konnte keinen Commander im Archidekt-Deck finden - erwartet eine Karte mit Kategorie "Commander"'
    );
  }

  return { commander, mainboard, maybeboard };
}
