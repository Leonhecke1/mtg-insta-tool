import { RawCardRef, RawDeckList } from "../types";

/**
 * Moxfields API ist inoffiziell/undokumentiert und hat sich in der
 * Vergangenheit mehrfach geaendert (v1 -> v2 -> v3, "boards"-Wrapper kam
 * spaeter dazu). Diese Funktion versucht mehrere bekannte Response-Formen,
 * bevor sie aufgibt. Falls Moxfield das Format erneut aendert: hier ansetzen.
 */

interface MoxfieldCardEntry {
  quantity?: number;
  card?: { name?: string };
}

type MoxfieldBoard = Record<string, MoxfieldCardEntry> | { cards?: Record<string, MoxfieldCardEntry> };

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

function toRawRefs(entries: MoxfieldCardEntry[]): RawCardRef[] {
  return entries
    .filter((e) => !!e.card?.name)
    .map((e) => ({ name: e.card!.name as string, quantity: e.quantity ?? 1 }));
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

  const commanderEntries = entriesFromBoard(boards.commanders);
  const mainEntries = entriesFromBoard(boards.mainboard);
  const maybeEntries = entriesFromBoard(boards.maybeboard);

  const commanderName = commanderEntries[0]?.card?.name;
  if (!commanderName) {
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
    commanderName,
    mainboard: toRawRefs(mainEntries),
    maybeboard: toRawRefs(maybeEntries),
  };
}
