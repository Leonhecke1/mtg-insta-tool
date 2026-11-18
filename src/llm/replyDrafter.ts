import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";

/**
 * Schlaegt eine Antwort auf einen Kommentar unter einem eigenen Post vor.
 * Ist nur ein Entwurf - veroeffentlicht wird erst nach Freigabe in der Queue.
 * Ohne ANTHROPIC_API_KEY kommt ein leerer Entwurf zurueck (manuell ausfuellen).
 */
export async function draftReply(
  commentText: string,
  username: string,
  postCaption?: string
): Promise<string> {
  if (!config.anthropicApiKey) return "";

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const prompt = `You run the Instagram account @floating.mana (budget-friendly, casual Commander/EDH deck techs). Write ONE reply to this comment under your own post.

Post caption (context): ${(postCaption ?? "").slice(0, 600)}

Comment by @${username}: "${commentText}"

Rules:
- English, 1-2 short sentences, sounds like a person, not a brand.
- No em dashes, no emojis unless the commenter used them, no "Great question!".
- If they ask for the decklist: it's linked in the caption / bio.
- If it's spam or a bot, reply with exactly: SKIP
- Answer only with the reply text.`;

  const msg = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 4000, // inkl. Thinking (Haiku 5.5 denkt standardmaessig)
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  return text.replace(/—/g, ",");
}
