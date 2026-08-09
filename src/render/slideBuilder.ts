import { Deck, EnrichedCard, GeneratedTexts } from "../types";
import { coverSlide } from "./slides/cover";
import { cropGridSlide } from "./slides/cropGrid";
import { gameplanSlide } from "./slides/gameplan";
import { priceSlide } from "./slides/price";
import { upgradesSlide } from "./slides/upgrades";

function isCreature(c: EnrichedCard): boolean {
  return /creature/i.test(c.typeLine);
}
function isLand(c: EnrichedCard): boolean {
  return /land/i.test(c.typeLine) && !isCreature(c);
}
function isSpell(c: EnrichedCard): boolean {
  return /instant|sorcery/i.test(c.typeLine) && !isCreature(c);
}
function isArtifactOrEnchantment(c: EnrichedCard, alreadyCreature: boolean, alreadyLand: boolean, alreadySpell: boolean): boolean {
  if (alreadyCreature || alreadyLand || alreadySpell) return false;
  return true; // Auffangbecken: Artefakte, Verzauberungen, Planeswalker, Battles etc.
}

/**
 * Baut die geordnete Liste der Slide-HTML-Dokumente. Kein API-Publish
 * mehr (siehe README) -> kein 10-Bilder-Hardlimit der Instagram Graph API
 * mehr noetig; Obergrenze ist die von Instagram fuer manuelle
 * Carousel-Uploads (20, siehe SPEC.md "Instagram-Publishing"). Reihenfolge:
 * Cover, Kreaturen+Commander, Spells, Artefakte/Verzauberungen, Laender,
 * Gameplan, Preis, Upgrades (nur falls Maybeboard vorhanden).
 */
const MAX_SLIDES = 20;

export function buildSlides(deck: Deck, texts: GeneratedTexts): string[] {
  const creatures = deck.mainboard.filter(isCreature);
  const lands = deck.mainboard.filter(isLand);
  const spells = deck.mainboard.filter(isSpell);
  const artifactsEnchantments = deck.mainboard.filter((c) =>
    isArtifactOrEnchantment(c, isCreature(c), isLand(c), isSpell(c))
  );

  const creatureTile = [deck.commander, ...creatures];

  const slides: string[] = [];

  slides.push(coverSlide(deck, texts.tagline));

  slides.push(
    cropGridSlide("Kreaturen + Commander", creatureTile.length, creatureTile, deck.colorIdentity, 2)
  );

  if (spells.length > 0) {
    slides.push(cropGridSlide("Spells", spells.length, spells, deck.colorIdentity, 3));
  }

  if (artifactsEnchantments.length > 0) {
    slides.push(
      cropGridSlide(
        "Artefakte + Verzauberungen",
        artifactsEnchantments.length,
        artifactsEnchantments,
        deck.colorIdentity,
        4
      )
    );
  }

  if (lands.length > 0) {
    // count = physische Gesamtzahl (Basics zaehlen mehrfach), Kacheln
    // bleiben pro Namen einmalig - Basics mit quantity>1 zeigen im
    // Crop-Grid ein "Nx"-Badge statt N identischer Kacheln.
    const totalLandCount = lands.reduce((sum, c) => sum + c.quantity, 0);
    slides.push(cropGridSlide("Laender", totalLandCount, lands, deck.colorIdentity, 5));
  }

  slides.push(gameplanSlide(deck, texts.gameplan));
  slides.push(priceSlide(deck));

  if (deck.maybeboard.length > 0) {
    slides.push(upgradesSlide(deck, texts.upgrades));
  }

  return slides.slice(0, MAX_SLIDES);
}
