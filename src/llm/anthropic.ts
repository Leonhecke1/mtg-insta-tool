import Anthropic from "@anthropic-ai/sdk";
import { config, requireAnthropicConfigured } from "../config";
import { Deck, GeneratedTexts } from "../types";
import { colorComboName } from "../render/theme";
import { commanderDisplayName, formatEur } from "../render/components";
import { fallbackTexts } from "./fallback";

const RESPONSE_SCHEMA_HINT = `Antworte AUSSCHLIESSLICH mit einem JSON-Objekt (kein Markdown, kein Fliesstext drumherum) in exakt dieser Form:
{
  "tagline": "ein Satz, max. 90 Zeichen",
  "gameplan": {
    "paragraphs": ["Absatz 1", "Absatz 2", "Absatz 3 (optional)"],
    "steps": ["Schritt 1 (kurz)", "Schritt 2 (kurz)", "Schritt 3 (kurz)"]
  },
  "caption": {
    "body": "Instagram-Caption, 2-4 Saetze, ohne Hashtags",
    "hashtags": ["#edh", "#commander", "..."]
  }
}`;

function buildPrompt(deck: Deck): string {
  const mainboardList = deck.mainboard
    .map((c) => `${c.quantity}x ${c.name} [${c.typeLine}]`)
    .join("\n");
  const commanderLines = deck.commanders
    .map((c) => `${c.name}${c.oracleText ? ` - ${c.oracleText}` : ""}`)
    .join("\n");

  return `Du schreibst Inhalte fuer einen Instagram-Deck-Tech-Carousel-Post ueber ein Magic: The Gathering Commander-Deck. Zielgruppe: MTG-Commander-Spieler, Ton: locker-kompetent, kein Hype-Marketing-Sprech, keine Emojis im Fliesstext.

Commander${deck.commanders.length > 1 ? " (Partner/Background)" : ""}: ${commanderDisplayName(deck.commanders)}
${commanderLines}
Farbidentitaet: ${colorComboName(deck.colorIdentity)} (${deck.colorIdentity.join("") || "farblos"})
Kartenanzahl: ${deck.cardCount}
Gesamtpreis (Cardmarket-Trend): ${formatEur(deck.totalPriceEur)}

Mainboard:
${mainboardList}

Aufgaben:
1. tagline: Ein pointierter Satz fuer die Cover-Slide, der die Strategie des Decks auf den Punkt bringt.
2. gameplan: 2-3 Absaetze, die erklaeren was das Deck macht (Strategie, Schluesselsynergien, Wincondition), basierend auf Commander(n) + Kartenliste. Danach eine 3-Schritte-Kurzzusammenfassung (z.B. "Rampen", "...", "...").
3. caption: Kurze Instagram-Caption (2-4 Saetze) + 8-15 relevante Hashtags (u.a. #edh #commander #mtg, plus deckspezifische wie Farbkombi/Commander-Name/Archetyp).

${RESPONSE_SCHEMA_HINT}`;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Keine JSON-Struktur in LLM-Antwort gefunden");
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

function validateAndNormalize(parsed: any): GeneratedTexts {
  const paragraphs: string[] = Array.isArray(parsed?.gameplan?.paragraphs)
    ? parsed.gameplan.paragraphs.filter((p: unknown) => typeof p === "string")
    : [];
  const steps = Array.isArray(parsed?.gameplan?.steps) ? parsed.gameplan.steps : [];

  const hashtags = Array.isArray(parsed?.caption?.hashtags)
    ? parsed.caption.hashtags.filter((h: unknown) => typeof h === "string")
    : [];

  if (paragraphs.length === 0 || typeof parsed?.tagline !== "string" || typeof parsed?.caption?.body !== "string") {
    throw new Error("LLM-Antwort unvollstaendig/ungueltig");
  }

  return {
    tagline: parsed.tagline,
    gameplan: {
      paragraphs,
      steps: [steps[0] ?? "", steps[1] ?? "", steps[2] ?? ""],
    },
    caption: {
      body: parsed.caption.body,
      hashtags: hashtags.length > 0 ? hashtags : ["#edh", "#commander", "#mtg"],
    },
  };
}

/**
 * Generiert alle Texte (Tagline, Gameplan, Caption) in einem einzigen
 * Claude-Call. Faellt bei fehlendem API-Key oder Fehlern auf
 * regelbasierte Platzhaeltertexte zurueck (siehe llm/fallback.ts) - so
 * bleibt der Preview-Modus ohne LLM-Kosten nutzbar.
 */
export async function generateTexts(deck: Deck, useLlm: boolean): Promise<GeneratedTexts> {
  if (!useLlm || !config.anthropicApiKey) {
    return fallbackTexts(deck);
  }

  requireAnthropicConfigured();
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  try {
    const message = await client.messages.create({
      model: config.anthropicModel,
      max_tokens: 2048,
      messages: [{ role: "user", content: buildPrompt(deck) }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Keine Text-Antwort von Claude erhalten");
    }

    const parsed = extractJson(textBlock.text);
    return validateAndNormalize(parsed);
  } catch (err) {
    console.error("[llm] Generierung fehlgeschlagen, nutze Fallback-Texte:", err);
    return fallbackTexts(deck);
  }
}
