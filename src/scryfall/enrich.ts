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

function resolveRefs(
  refs: RawCardRef[],
  found: Map<string, ScryfallCard>,
  notFound: string[]
): EnrichedCard[] {
  const cards: EnrichedCard[] = [];
  for (const ref of refs) {
    const card = found.get(ref.name.toLowerCase());
    if (!card) {
      notFound.push(ref.name);
      continue;
    }
    cards.push(toEnrichedCard(card, ref.quantity));
  }
  return cards;
}

/**
 * Reichert eine RawDeckList mit Scryfall-Kartendaten an und baut das
 * interne Deck-Modell. Wirft, wenn der Commander selbst nicht gefunden
 * wurde; einzelne nicht gefundene Mainboard/Maybeboard-Karten werden
 * uebersprungen und im Fehlerobjekt (notFoundNames) gesammelt.
 */
export async function enrichDeck(
  raw: RawDeckList
): Promise<{ deck: Deck; notFoundNames: string[] }> {
  const allNames = [
    raw.commanderName,
    ...raw.mainboard.map((c) => c.name),
    ...raw.maybeboard.map((c) => c.name),
  ];

  const { found, notFound: fetchNotFound } = await fetchScryfallCards(allNames);
  const notFoundNames = [...fetchNotFound];

  const commanderCard = found.get(raw.commanderName.toLowerCase());
  if (!commanderCard) {
    throw new Error(
      `Commander "${raw.commanderName}" wurde bei Scryfall nicht gefunden. Namen pruefen (Sonderzeichen wie "Jötun"?).`
    );
  }
  const commander = toEnrichedCard(commanderCard, 1);

  const mainboard = resolveRefs(raw.mainboard, found, notFoundNames);
  const maybeboard = resolveRefs(raw.maybeboard, found, notFoundNames);

  const colorIdentitySet = new Set<ColorCode>(commander.colorIdentity);
  for (const c of mainboard) {
    for (const col of c.colorIdentity) colorIdentitySet.add(col);
  }
  const colorIdentity = COLOR_ORDER.filter((c) => colorIdentitySet.has(c));

  const cardCount =
    1 + mainboard.reduce((sum, c) => sum + c.quantity, 0);

  const totalPriceEur =
    (commander.priceEur ?? 0) +
    mainboard.reduce((sum, c) => sum + (c.priceEur ?? 0) * c.quantity, 0);

  const deck: Deck = {
    commander,
    mainboard,
    maybeboard,
    colorIdentity,
    totalPriceEur,
    cardCount,
  };

  return { deck, notFoundNames };
}
