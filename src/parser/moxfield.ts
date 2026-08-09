import { CardFallbackData, ColorCode, RawCardRef, RawDeckList } from "../types";
import { scryfallCdnImageUrl } from "../scryfall/client";

/**
 * Moxfields API ist inoffiziell/undokumentiert und hat sich in der
 * Vergangenheit mehrfach geaendert (v1 -> v2 -> v3, "boards"-Wrapper kam
 * spaeter dazu). Diese Funktion versucht mehrere bekannte Response-Formen,
 * bevor sie aufgibt. Falls Moxfield das Format erneut aendert: hier ansetzen.
 *
 * Moxfields eingebettetes Karten-Objekt spiegelt Scryfalls eigenes Schema
 * fast 1:1 (type_line, oracle_text, mana_cost, color_identity als
 * Buchstaben-Codes, prices.eur, scryfall_id) - verifiziert gegen eine
 * echte Deck-Response. Diese Daten werden als Fallback mitgegeben, falls
 * Scryfalls eigene API mal nicht antwortet (siehe scryfall/enrich.ts).
 */

interface MoxfieldCardFace {
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
}

interface MoxfieldCard {
  name?: string;
  type_line?: string;
  oracle_text?: string;
  mana_cost?: string;
  color_identity?: string[];
  scryfall_id?: string;
  prices?: { eur?: number | null };
  card_faces?: MoxfieldCardFace[];
}

interface MoxfieldCardEntry {
  quantity?: number;
  card?: MoxfieldCard;
}

function entriesFromBoard(board: unknown): MoxfieldCardEntry[] {
  if (!board || typeof board !== "object") return [];
  const b = board as Record<string, unknown>;
  const container = (b.cards && typeof b.cards === "object" ? b.cards : b) as Record<
    string,
    MoxfieldCardEntry
  >;
  return Object.values(container).filter(
    (e): e is MoxfieldCardEntry => !!e && typeof e === "object" && !!e.card?.name
  );
}

function buildFallback(card: MoxfieldCard): CardFallbackData {
  const face = card.card_faces?.[0];
  return {
    manaCost: card.mana_cost || face?.mana_cost || "",
    typeLine: card.type_line || face?.type_line || "",
    oracleText: card.oracle_text || face?.oracle_text || "",
    colorIdentity: (card.color_identity ?? []) as ColorCode[],
    imageNormal: card.scryfall_id ? scryfallCdnImageUrl(card.scryfall_id) : null,
    priceEur: card.prices?.eur ?? null,
  };
}

function toRawRefs(entries: MoxfieldCardEntry[]): RawCardRef[] {
  return entries
    .filter((e) => !!e.card?.name)
    .map((e) => ({
      name: e.card!.name as string,
      quantity: e.quantity ?? 1,
      fallback: buildFallback(e.card!),
    }));
}

export function extractPublicId(input: string): string {
  const trimmed = input.trim();
  // Bereits eine nackte publicId (keine URL-Zeichen)
  if (!/^https?:\/\//i.test(trimmed) && !trimmed.includes("/")) {
    return trimmed;
  }
  // https://www.moxfield.com/decks/{publicId}  oder  https://api.moxfield.com/v3/decks/all/{publicId}
  const match = trimmed.match(/decks\/(?:all\/)?([A-Za-z0-9_-]+)\/?$/);
  if (!match) {
    throw new Error(`Konnte Moxfield-publicId nicht aus "${input}" extrahieren`);
  }
  return match[1];
}

export async function fetchMoxfieldDeck(urlOrId: string): Promise<RawDeckList> {
  const publicId = extractPublicId(urlOrId);
  const apiUrl = `https://api.moxfield.com/v3/decks/all/${publicId}`;

  // Bewusst native fetch statt axios - siehe scryfall/client.ts fuer den
  // Hintergrund (axios wurde von Scryfalls Cloudflare-Edge geblockt,
  // gleiche Vorsicht hier).
  const res = await fetch(apiUrl, {
    headers: {
      "User-Agent": "mtg-insta-tool/0.1 (+https://github.com/)",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`Moxfield ${res.status} bei ${apiUrl}: ${bodyText.slice(0, 300)}`);
  }
  const data = (await res.json()) as Record<string, unknown>;

  const boards = (data.boards ?? data) as Record<string, unknown>;

  // commanderEntries kann 2 Eintraege haben (Partner/Background/Friends
  // Forever). Maybeboard + Sideboard werden zusammengelegt - bei
  // Commander-Decks landen Upgrade-Kandidaten je nach Nutzer in dem einen
  // oder anderen "Board".
  const commanderEntries = entriesFromBoard(boards.commanders);
  const mainEntries = entriesFromBoard(boards.mainboard);
  const maybeEntries = [...entriesFromBoard(boards.maybeboard), ...entriesFromBoard(boards.sideboard)];

  if (commanderEntries.length === 0) {
    throw new Error(
      "Konnte keinen Commander im Moxfield-Deck finden - Response-Format hat sich moeglicherweise geaendert (boards.commanders)"
    );
  }

  if (mainEntries.length === 0) {
    throw new Error(
      "Mainboard leer/nicht gefunden - Moxfield Response-Format pruefen (boards.mainboard)"
    );
  }

  return {
    commanders: commanderEntries.map((e) => ({
      name: e.card!.name as string,
      quantity: 1,
      fallback: buildFallback(e.card!),
    })),
    mainboard: toRawRefs(mainEntries),
    maybeboard: toRawRefs(maybeEntries),
  };
}
