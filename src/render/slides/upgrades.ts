import { Deck } from "../../types";
import { cropGridSlide } from "./cropGrid";

/**
 * Upgrades-Slide: alle Maybeboard/Sideboard-Karten als kompaktes Crop-Grid
 * (wie Kreaturen/Spells/etc.) mit Preis-Badge statt Einzeiler-Text pro
 * Karte - bewusst keine Deckelung auf wenige Karten mehr, dafuer pro Karte
 * weniger Detail (nur Bild + Preis, kein Freitext).
 */
export function upgradesSlide(deck: Deck): string {
  return cropGridSlide(
    "Upgrades",
    deck.maybeboard.length,
    deck.maybeboard,
    deck.colorIdentity,
    7,
    { showPrice: true }
  );
}
