import { ColorCode, Deck, EnrichedCard, RawCardRef, RawDeckList } from "../types";
import { fetchScryfallCards, ScryfallCard } from "./client";

const COLOR_ORDER: ColorCode[] = ["W", "U", "B", "R", "G"];

function sortColorIdentity(colors: string[]): ColorCode[] {
  const set = new Set(colors as ColorCode[]);
  return COLOR_ORDER.filter((c) => set.has(c));
}

/**
 * Doppelseitige Karten (Modal DFC, Transform) liefern image_uris,
 * mana_cost, type_line und oracle_text oft nur auf card_faces[0],
 * nicht auf Top-Level. Siehe SPEC.md "Bekannte Stolpersteine".
 */
function toEnrichedCard(card: ScryfallCard, quantity: number): EnrichedCard {
  const face = card.card_faces?.[0];

  const imageUris = card.image_uris ?? face?.image_uris;
  const manaCost = card.mana_cost || face?.mana_cost || "";
  const typeLine = card.type_line || face?.type_line || "";
  const oracleText = card.oracle_text || face?.oracle_text || "";

  const priceEurRaw = card.prices?.eur;
  const priceEur = priceEurRaw != null ? parseFloat(priceEurRaw) : null;

  return {
    name: card.name,
    quantity,
    manaCost,
    typeLine,
    oracleText,
    colorIdentity: sortColorIdentity(card.color_identity ?? []),
    imageNormal: imageUris?.normal ?? null,
    imageArtCrop: imageUris?.art_crop ?? null,
    priceEur: priceEur != null && !Number.isNaN(priceEur) ? priceEur : null,
    scryfallId: card.id,
  };
}

/**
 * Baut eine EnrichedCard aus den von Moxfield/Archidekt mitgelieferten
 * Fallback-Daten (siehe types.ts CardFallbackData), wenn Scryfall die
 * Karte nicht liefern konnte.
 */
function fallbackToEnrichedCard(ref: RawCardRef): EnrichedCard {
  const fb = ref.fallback!;
  return {
    name: ref.name,
    quantity: ref.quantity,
    manaCost: fb.manaCost,
    typeLine: fb.typeLine,
    oracleText: fb.oracleText,
    colorIdentity: sortColorIdentity(fb.colorIdentity),
    imageNormal: fb.imageNormal,
    imageArtCrop: null,
    priceEur: fb.priceEur,
    scryfallId: "",
  };
}

function resolveRef(
  ref: RawCardRef,
  found: Map<string, ScryfallCard>,
  notFound: string[],
  usedFallback: string[]
): EnrichedCard | null {
  const card = found.get(ref.name.toLowerCase());
  if (card) return toEnrichedCard(card, ref.quantity);
  if (ref.fallback) {
    usedFallback.push(ref.name);
    return fallbackToEnrichedCard(ref);
  }
  notFound.push(ref.name);
  return null;
}

function resolveRefs(
  refs: RawCardRef[],
  found: Map<string, ScryfallCard>,
  notFound: string[],
  usedFallback: string[]
): EnrichedCard[] {
  const cards: EnrichedCard[] = [];
  for (const ref of refs) {
    const card = resolveRef(ref, found, notFound, usedFallback);
    if (card) cards.push(card);
  }
  return cards;
}

/**
 * Reichert eine RawDeckList mit Scryfall-Kartendaten an und baut das
 * interne Deck-Modell. Wenn die Scryfall-Abfrage insgesamt fehlschlaegt
 * (z.B. Wartungsfenster) oder einzelne Karten nicht liefert, wird pro
 * Karte auf die von Moxfield/Archidekt mitgelieferten Fallback-Daten
 * zurueckgegriffen (siehe parser/moxfield.ts, parser/archidekt.ts) -
 * bei Rohtext-Importen gibt es keinen Fallback, dort ist Scryfall Pflicht.
 * Wirft nur, wenn KEIN Commander aufloesbar ist (1 oder 2 - Partner/
 * Background/Friends Forever); einzelne nicht aufloesbare
 * Mainboard/Maybeboard-Karten oder ein einzelner nicht aufloesbarer
 * Partner-Commander werden uebersprungen und in notFoundNames gesammelt.
 */
export async function enrichDeck(
  raw: RawDeckList
): Promise<{ deck: Deck; notFoundNames: string[]; usedFallbackNames: string[] }> {
  const allNames = [
    ...raw.commanders.map((c) => c.name),
    ...raw.mainboard.map((c) => c.name),
    ...raw.maybeboard.map((c) => c.name),
  ];

  let found = new Map<string, ScryfallCard>();
  try {
    found = (await fetchScryfallCards(allNames)).found;
  } catch (err) {
    console.warn(
      "[scryfall] Kartenabfrage komplett fehlgeschlagen, nutze nur Moxfield/Archidekt-Fallback-Daten wo vorhanden:",
      err instanceof Error ? err.message : err
    );
  }

  const notFoundNames: string[] = [];
  const usedFallbackNames: string[] = [];

  const commanders = resolveRefs(raw.commanders, found, notFoundNames, usedFallbackNames);
  if (commanders.length === 0) {
    const names = raw.commanders.map((c) => `"${c.name}"`).join(", ");
    throw new Error(
      `Commander (${names}) wurden bei Scryfall nicht gefunden und es liegen keine Fallback-Daten vor. Namen pruefen (Sonderzeichen wie "Jötun"?).`
    );
  }

  const mainboard = resolveRefs(raw.mainboard, found, notFoundNames, usedFallbackNames);
  const maybeboard = resolveRefs(raw.maybeboard, found, notFoundNames, usedFallbackNames);

  const colorIdentitySet = new Set<ColorCode>();
  for (const c of commanders) {
    for (const col of c.colorIdentity) colorIdentitySet.add(col);
  }
  for (const c of mainboard) {
    for (const col of c.colorIdentity) colorIdentitySet.add(col);
  }
  const colorIdentity = COLOR_ORDER.filter((c) => colorIdentitySet.has(c));

  const cardCount =
    commanders.length + mainboard.reduce((sum, c) => sum + c.quantity, 0);

  const totalPriceEur =
    commanders.reduce((sum, c) => sum + (c.priceEur ?? 0), 0) +
    mainboard.reduce((sum, c) => sum + (c.priceEur ?? 0) * c.quantity, 0);

  const deck: Deck = {
    commanders,
    mainboard,
    maybeboard,
    colorIdentity,
    totalPriceEur,
    cardCount,
  };

  return { deck, notFoundNames, usedFallbackNames };
}
