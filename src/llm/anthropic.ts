import Anthropic from "@anthropic-ai/sdk";
import { config, requireAnthropicConfigured } from "../config";
import { Deck, GeneratedTexts } from "../types";
import { colorComboName } from "../render/theme";
import { commanderDisplayName, formatEur } from "../render/components";
import { fallbackTexts } from "./fallback";

const RESPONSE_SCHEMA_HINT = `Reply with ONLY a JSON object (no markdown, no surrounding prose) in exactly this shape:
{
  "tagline": "one sentence, max. 90 characters",
  "flavor": "a short evocative badge line, max. 40 characters",
  "gameplan": {
    "paragraphs": ["Paragraph 1", "Paragraph 2", "Paragraph 3 (optional)"],
    "steps": ["Step 1 (short)", "Step 2 (short)", "Step 3 (short)"]
  },
  "caption": {
    "body": "Instagram caption, 2-4 sentences, no hashtags",
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

  return `You are writing content for an Instagram deck-tech carousel post about a Magic: The Gathering Commander deck. Write everything in English. Audience: MTG Commander players, tone: casual-competent, no hype marketing speak, no emojis in the body text.

Commander${deck.commanders.length > 1 ? " (Partner/Background)" : ""}: ${commanderDisplayName(deck.commanders)}
${commanderLines}
Color identity: ${colorComboName(deck.colorIdentity)} (${deck.colorIdentity.join("") || "colorless"})
Card count: ${deck.cardCount}
Total price (Cardmarket trend): ${formatEur(deck.totalPriceEur)}

Mainboard:
${mainboardList}

Tasks:
1. tagline: A punchy sentence for the cover slide that nails the deck's strategy.
2. flavor: A short evocative line for a small badge on the cover slide - written like real Magic card flavor text (moody, thematic, in-world), not a literal label like "Deck Tech" or a data tag like "Simic - EDH". Think of the italic quote at the bottom of a card.
3. gameplan: 2-3 paragraphs explaining what the deck does (strategy, key synergies, win condition), based on the commander(s) + card list. Then a 3-step short summary (e.g. "Ramp", "...", "...").
4. caption: Short Instagram caption (2-4 sentences) + 8-15 relevant hashtags (incl. #edh #commander #mtg, plus deck-specific ones like color combo/commander name/archetype).

${RESPONSE_SCHEMA_HINT}`;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("No JSON structure found in LLM response");
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
    throw new Error("LLM response incomplete/invalid");
  }

  return {
    tagline: parsed.tagline,
    flavor: typeof parsed.flavor === "string" && parsed.flavor.trim() ? parsed.flavor : "Deck Tech",
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
      max_tokens: 16000, // inkl. Thinking (Haiku 5.5 denkt standardmaessig)
      messages: [{ role: "user", content: buildPrompt(deck) }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Keine Text-Antwort von Claude erhalten");
    }

    const parsed = extractJson(textBlock.text);
    return validateAndNormalize(parsed);
  } catch (err) {
    console.error("[llm] Generation failed, using fallback texts:", err);
    return fallbackTexts(deck);
  }
}
