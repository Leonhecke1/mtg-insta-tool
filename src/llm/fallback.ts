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
    tagline: `A ${combo} deck built around ${commanderName}.`,
    // No LLM available to write real flavor text - fall back to a plain
    // archetype tag instead of guessing at something evocative.
    flavor: `${combo} · EDH`,
    gameplan: {
      paragraphs: [
        `${commanderName} is the centerpiece of this ${combo} deck with ${deck.cardCount} cards.`,
        `The mainboard combines ${deck.mainboard.length} cards that feed into the commander - for more detail, generate with LLM mode (set ANTHROPIC_API_KEY) or edit it yourself (click the slide).`,
      ],
      steps: ["Ramp & build the board", "Connect the synergies", "Push the commander through"],
    },
    caption: {
      body: `Deck Tech: ${commanderName} (${combo}) - ${deck.cardCount} cards, ${formatEur(
        deck.totalPriceEur
      )} Cardmarket trend.`,
      hashtags: ["#edh", "#commander", "#mtg", "#magicthegathering", "#deckTech"],
    },
  };
}
