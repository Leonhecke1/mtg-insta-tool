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
 * Baut die geordnete Liste der Slide-HTML-Dokumente (max. 10, siehe
 * SPEC.md "Slide-Struktur"). Reihenfolge: Cover, Kreaturen+Commander,
 * Spells, Artefakte/Verzauberungen, Gameplan, Preis, Upgrades (nur falls
 * Maybeboard vorhanden).
 */
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

  const artTitle =
    lands.length > 0
      ? `Artefakte + Verzauberungen`
      : "Artefakte + Verzauberungen";
  if (artifactsEnchantments.length > 0) {
    const label =
      lands.length > 0 ? `${artTitle} (+ ${lands.length} Laender)` : artTitle;
    slides.push(
      cropGridSlide(label, artifactsEnchantments.length, artifactsEnchantments, deck.colorIdentity, 4)
    );
  }

  slides.push(gameplanSlide(deck, texts.gameplan));
  slides.push(priceSlide(deck));

  if (deck.maybeboard.length > 0) {
    slides.push(upgradesSlide(deck, texts.upgrades));
  }

  return slides.slice(0, 10);
}
