import { Deck, GeneratedTexts } from "../types";
import { colorComboName } from "../render/theme";
import { commanderDisplayName, formatEur } from "../render/components";

/**
 * Regelbasierte Platzhaeltertexte ohne LLM-Aufruf. Wird genutzt, wenn
 * kein ANTHROPIC_API_KEY gesetzt ist oder useLlm=false (Default - siehe
 * README, LLM-Nutzung ist opt-in wegen separatem API-Guthaben).
 */
export function fallbackTexts(deck: Deck): GeneratedTexts {
  const combo = colorComboName(deck.colorIdentity);
  const commanderName = commanderDisplayName(deck.commanders);

  return {
    tagline: `${combo}-Deck rund um ${commanderName}.`,
    gameplan: {
      paragraphs: [
        `${commanderName} bildet das Zentrum dieses ${combo}-Decks mit ${deck.cardCount} Karten.`,
        `Das Mainboard kombiniert ${deck.mainboard.length} Karten, die auf den Commander einzahlen - Details dazu bitte im LLM-Modus generieren lassen (ANTHROPIC_API_KEY setzen) oder selbst bearbeiten (Slide anklicken).`,
      ],
      steps: ["Rampen & Board aufbauen", "Synergien vernetzen", "Commander durchsetzen"],
    },
    caption: {
      body: `Deck Tech: ${commanderName} (${combo}) - ${deck.cardCount} Karten, ${formatEur(
        deck.totalPriceEur
      )} Cardmarket-Trend.`,
      hashtags: ["#edh", "#commander", "#mtg", "#magicthegathering", "#deckTech"],
    },
  };
}
