import { Deck, GeneratedTexts } from "../types";
import { colorComboName } from "../render/theme";
import { formatEur } from "../render/components";

/**
 * Regelbasierte Platzhaeltertexte ohne LLM-Aufruf. Wird genutzt, wenn
 * kein ANTHROPIC_API_KEY gesetzt ist oder useLlm=false (schneller
 * Preview-Modus, siehe SPEC.md MVP-Schritt 6 "als Feinschliff").
 */
export function fallbackTexts(deck: Deck): GeneratedTexts {
  const combo = colorComboName(deck.colorIdentity);

  return {
    tagline: `${combo}-Deck rund um ${deck.commander.name}.`,
    gameplan: {
      paragraphs: [
        `${deck.commander.name} bildet das Zentrum dieses ${combo}-Decks mit ${deck.cardCount} Karten.`,
        `Das Mainboard kombiniert ${deck.mainboard.length} Karten, die auf den Commander einzahlen - Details dazu bitte im LLM-Modus generieren lassen (ANTHROPIC_API_KEY setzen).`,
      ],
      steps: ["Rampen & Board aufbauen", "Synergien vernetzen", "Commander durchsetzen"],
    },
    upgrades: deck.maybeboard.map((c) => ({
      cardName: c.name,
      oneLiner: "Platzhalter-Upgrade-Hinweis (LLM-Modus aktivieren fuer echten Text).",
    })),
    caption: {
      body: `Deck Tech: ${deck.commander.name} (${combo}) - ${deck.cardCount} Karten, ${formatEur(
        deck.totalPriceEur
      )} Cardmarket-Trend.`,
      hashtags: ["#edh", "#commander", "#mtg", "#magicthegathering", "#deckTech"],
    },
  };
}
