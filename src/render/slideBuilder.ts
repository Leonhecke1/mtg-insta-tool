import { ColorCode, Deck, EnrichedCard, GeneratedTexts, SlideKind } from "../types";
import { analyticsSlide } from "./slides/analytics";
import { coverSlide } from "./slides/cover";
import { cropGridSlide } from "./slides/cropGrid";
import { gameplanSlide } from "./slides/gameplan";
import { heroCoverSlide } from "./slides/hero";
import { priceSlide } from "./slides/price";
import { upgradesSlide } from "./slides/upgrades";
import { isArtifactOrEnchantment, isCreature, isInstant, isLand, isSorcery } from "./classify";

export interface BuiltSlide {
  html: string;
  kind: SlideKind;
}

/**
 * Baut die geordnete Liste der Slides (HTML + Kind-Tag). Kind-Tag erlaubt
 * dem Web-UI, pro Slide zu wissen welcher Text-Teil (falls vorhanden)
 * bearbeitbar ist (siehe server.ts POST /api/jobs/:id/texts). Kein
 * API-Publish mehr (siehe README) -> kein 10-Bilder-Hardlimit der
 * Instagram Graph API mehr noetig; Obergrenze ist die von Instagram fuer
 * manuelle Carousel-Uploads (20, siehe SPEC.md "Instagram-Publishing").
 * Reihenfolge: Hero (grosses Commander-Artwork), Cover, Kreaturen+Commander,
 * Spontanzauber (Instants),
 * Hexereien (Sorceries), Artefakte/Verzauberungen, Laender, Deck-Breakdown
 * (Mana-Kurve + Farbpips), Gameplan, Preis, Upgrades (nur falls
 * Maybeboard/Sideboard vorhanden).
 */
const MAX_SLIDES = 20;
// Keeps every crop-grid tile legible - beyond this many cards per category,
// split across multiple slides instead of shrinking tiles further.
const MAX_CARDS_PER_SLIDE = 16;

function splitIntoChunks<T>(items: T[], maxPerChunk: number): T[][] {
  if (items.length <= maxPerChunk) return [items];
  const numChunks = Math.ceil(items.length / maxPerChunk);
  const chunkSize = Math.ceil(items.length / numChunks);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function pushCardSlides(
  slides: BuiltSlide[],
  kind: SlideKind,
  baseTitle: string,
  displayCount: number,
  cards: EnrichedCard[],
  colorIdentity: ColorCode[],
  seed: number
): void {
  const chunks = splitIntoChunks(cards, MAX_CARDS_PER_SLIDE);
  chunks.forEach((chunk, i) => {
    const title = chunks.length > 1 ? `${baseTitle} (${i + 1}/${chunks.length})` : baseTitle;
    slides.push({
      html: cropGridSlide(title, displayCount, chunk, colorIdentity, seed),
      kind,
    });
  });
}

export function buildSlides(deck: Deck, texts: GeneratedTexts): BuiltSlide[] {
  const creatures = deck.mainboard.filter(isCreature);
  const lands = deck.mainboard.filter(isLand);
  const instants = deck.mainboard.filter(isInstant);
  const sorceries = deck.mainboard.filter(isSorcery);
  const artifactsEnchantments = deck.mainboard.filter(isArtifactOrEnchantment);

  const creatureTile = [...deck.commanders, ...creatures];

  const slides: BuiltSlide[] = [];

  slides.push({ html: heroCoverSlide(deck), kind: "hero" });
  slides.push({ html: coverSlide(deck, texts.tagline, texts.flavor), kind: "cover" });

  pushCardSlides(
    slides,
    "creatures",
    "Creatures + Commander",
    creatureTile.length,
    creatureTile,
    deck.colorIdentity,
    2
  );

  if (instants.length > 0) {
    pushCardSlides(slides, "instants", "Instants", instants.length, instants, deck.colorIdentity, 3);
  }

  if (sorceries.length > 0) {
    pushCardSlides(slides, "sorceries", "Sorceries", sorceries.length, sorceries, deck.colorIdentity, 8);
  }

  if (artifactsEnchantments.length > 0) {
    pushCardSlides(
      slides,
      "artifacts",
      "Artifacts + Enchantments",
      artifactsEnchantments.length,
      artifactsEnchantments,
      deck.colorIdentity,
      4
    );
  }

  if (lands.length > 0) {
    // count = physical total (basics count multiple times), tiles stay
    // one-per-name - basics with quantity>1 show an "Nx" badge in the
    // crop grid instead of N identical tiles.
    const totalLandCount = lands.reduce((sum, c) => sum + c.quantity, 0);
    pushCardSlides(slides, "lands", "Lands", totalLandCount, lands, deck.colorIdentity, 5);
  }

  slides.push({ html: analyticsSlide(deck), kind: "analytics" });

  slides.push({ html: gameplanSlide(deck, texts.gameplan), kind: "gameplan" });
  slides.push({ html: priceSlide(deck), kind: "price" });

  if (deck.maybeboard.length > 0) {
    slides.push({ html: upgradesSlide(deck), kind: "upgrades" });
  }

  return slides.slice(0, MAX_SLIDES);
}
