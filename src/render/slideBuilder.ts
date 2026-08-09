import { Deck, EnrichedCard, GeneratedTexts, SlideKind } from "../types";
import { coverSlide } from "./slides/cover";
import { cropGridSlide } from "./slides/cropGrid";
import { gameplanSlide } from "./slides/gameplan";
import { priceSlide } from "./slides/price";
import { upgradesSlide } from "./slides/upgrades";

export interface BuiltSlide {
  html: string;
  kind: SlideKind;
}

function isCreature(c: EnrichedCard): boolean {
  return /creature/i.test(c.typeLine);
}
function isLand(c: EnrichedCard): boolean {
  return /land/i.test(c.typeLine) && !isCreature(c);
}
function isInstant(c: EnrichedCard): boolean {
  return /instant/i.test(c.typeLine) && !isCreature(c);
}
function isSorcery(c: EnrichedCard): boolean {
  return /sorcery/i.test(c.typeLine) && !isCreature(c);
}
function isArtifactOrEnchantment(
  c: EnrichedCard,
  alreadyCreature: boolean,
  alreadyLand: boolean,
  alreadyInstant: boolean,
  alreadySorcery: boolean
): boolean {
  if (alreadyCreature || alreadyLand || alreadyInstant || alreadySorcery) return false;
  return true; // Auffangbecken: Artefakte, Verzauberungen, Planeswalker, Battles etc.
}

/**
 * Baut die geordnete Liste der Slides (HTML + Kind-Tag). Kind-Tag erlaubt
 * dem Web-UI, pro Slide zu wissen welcher Text-Teil (falls vorhanden)
 * bearbeitbar ist (siehe server.ts POST /api/jobs/:id/texts). Kein
 * API-Publish mehr (siehe README) -> kein 10-Bilder-Hardlimit der
 * Instagram Graph API mehr noetig; Obergrenze ist die von Instagram fuer
 * manuelle Carousel-Uploads (20, siehe SPEC.md "Instagram-Publishing").
 * Reihenfolge: Cover, Kreaturen+Commander, Spontanzauber (Instants),
 * Hexereien (Sorceries), Artefakte/Verzauberungen, Laender, Gameplan,
 * Preis, Upgrades (nur falls Maybeboard/Sideboard vorhanden).
 */
const MAX_SLIDES = 20;

export function buildSlides(deck: Deck, texts: GeneratedTexts): BuiltSlide[] {
  const creatures = deck.mainboard.filter(isCreature);
  const lands = deck.mainboard.filter(isLand);
  const instants = deck.mainboard.filter(isInstant);
  const sorceries = deck.mainboard.filter(isSorcery);
  const artifactsEnchantments = deck.mainboard.filter((c) =>
    isArtifactOrEnchantment(c, isCreature(c), isLand(c), isInstant(c), isSorcery(c))
  );

  const creatureTile = [...deck.commanders, ...creatures];

  const slides: BuiltSlide[] = [];

  slides.push({ html: coverSlide(deck, texts.tagline), kind: "cover" });

  slides.push({
    html: cropGridSlide("Kreaturen + Commander", creatureTile.length, creatureTile, deck.colorIdentity, 2),
    kind: "creatures",
  });

  if (instants.length > 0) {
    slides.push({
      html: cropGridSlide("Spontanzauber", instants.length, instants, deck.colorIdentity, 3),
      kind: "instants",
    });
  }

  if (sorceries.length > 0) {
    slides.push({
      html: cropGridSlide("Hexereien", sorceries.length, sorceries, deck.colorIdentity, 8),
      kind: "sorceries",
    });
  }

  if (artifactsEnchantments.length > 0) {
    slides.push({
      html: cropGridSlide(
        "Artefakte + Verzauberungen",
        artifactsEnchantments.length,
        artifactsEnchantments,
        deck.colorIdentity,
        4
      ),
      kind: "artifacts",
    });
  }

  if (lands.length > 0) {
    // count = physische Gesamtzahl (Basics zaehlen mehrfach), Kacheln
    // bleiben pro Namen einmalig - Basics mit quantity>1 zeigen im
    // Crop-Grid ein "Nx"-Badge statt N identischer Kacheln.
    const totalLandCount = lands.reduce((sum, c) => sum + c.quantity, 0);
    slides.push({
      html: cropGridSlide("Laender", totalLandCount, lands, deck.colorIdentity, 5),
      kind: "lands",
    });
  }

  slides.push({ html: gameplanSlide(deck, texts.gameplan), kind: "gameplan" });
  slides.push({ html: priceSlide(deck), kind: "price" });

  if (deck.maybeboard.length > 0) {
    slides.push({ html: upgradesSlide(deck), kind: "upgrades" });
  }

  return slides.slice(0, MAX_SLIDES);
}
