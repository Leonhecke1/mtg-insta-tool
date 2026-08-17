import { EnrichedCard } from "../types";

/**
 * Shared type-line classification used by both the crop-grid slide split
 * (slideBuilder.ts) and the price breakdown (slides/price.ts), so both
 * agree on what counts as a land/creature/spell/other.
 */
export function isCreature(c: EnrichedCard): boolean {
  return /creature/i.test(c.typeLine);
}
export function isLand(c: EnrichedCard): boolean {
  return /land/i.test(c.typeLine) && !isCreature(c);
}
export function isInstant(c: EnrichedCard): boolean {
  return /instant/i.test(c.typeLine) && !isCreature(c);
}
export function isSorcery(c: EnrichedCard): boolean {
  return /sorcery/i.test(c.typeLine) && !isCreature(c);
}
// Catch-all: artifacts, enchantments, planeswalkers, battles etc.
export function isArtifactOrEnchantment(c: EnrichedCard): boolean {
  return !isCreature(c) && !isLand(c) && !isInstant(c) && !isSorcery(c);
}

/**
 * Mana value (converted mana cost) parsed straight from the manaCost string
 * rather than a dedicated Scryfall "cmc" field, since that's the one piece
 * of cost data we get uniformly from Scryfall AND the Moxfield/Archidekt
 * fallback (see analytics.ts). Follows the official CR 202.3 rules: X/Y/Z
 * contribute 0, hybrid/monocolored-hybrid symbols ("{2/W}") contribute the
 * higher of their two halves, everything else (colored, Phyrexian) is 1.
 */
export function manaValue(c: EnrichedCard): number {
  const symbols = c.manaCost.match(/\{[^}]+\}/g) ?? [];
  return symbols.reduce((sum, sym) => {
    const inner = sym.slice(1, -1);
    if (/^[xyz]$/i.test(inner)) return sum;
    if (/^\d+$/.test(inner)) return sum + parseInt(inner, 10);
    if (inner.includes("/")) {
      const parts = inner.split("/").map((p) => (/^\d+$/.test(p) ? parseInt(p, 10) : 1));
      return sum + Math.max(...parts);
    }
    return sum + 1;
  }, 0);
}
