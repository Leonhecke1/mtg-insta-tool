import { RawCardRef, RawDeckList } from "../types";

/**
 * Archidekts API ist wie Moxfields inoffiziell/undokumentiert. Deck-Daten
 * kommen als eine flache "cards"-Liste (kein "boards"-Wrapper wie bei
 * Moxfield) - Board-Zugehoerigkeit (Commander/Maybeboard/Sideboard) wird
 * ueber die "categories" jeder Karte ausgedrueckt. Falls Archidekt das
 * Format aendert: hier ansetzen.
 */

interface ArchidektCardEntry {
  quantity?: number;
  categories?: string[];
  category?: string;
  card?: {
    name?: string;
    oracleCard?: { name?: string };
  };
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

  let commanderName: string | undefined;
  const mainboard: RawCardRef[] = [];
  const maybeboard: RawCardRef[] = [];

  for (const entry of entries) {
    const name = cardName(entry);
    if (!name) continue;
    const quantity = entry.quantity ?? 1;
    const categories = categoriesOf(entry);

    if (categories.includes("commander")) {
      commanderName = name;
      continue;
    }
    if (categories.includes("sideboard")) {
      continue; // wie bei Moxfield: fuer EDH-Deck-Techs nicht relevant
    }
    if (categories.includes("maybeboard") || categories.includes("maybe board")) {
      maybeboard.push({ name, quantity });
      continue;
    }
    mainboard.push({ name, quantity });
  }

  if (!commanderName) {
    throw new Error(
      'Konnte keinen Commander im Archidekt-Deck finden - erwartet eine Karte mit Kategorie "Commander"'
    );
  }

  return { commanderName, mainboard, maybeboard };
}
