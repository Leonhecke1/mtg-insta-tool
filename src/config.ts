import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: parseInt(optional("PORT", "3000"), 10),

  basicAuthUser: optional("BASIC_AUTH_USER"),
  basicAuthPass: optional("BASIC_AUTH_PASS"),

  anthropicApiKey: optional("ANTHROPIC_API_KEY"),
  anthropicModel: optional("ANTHROPIC_MODEL", "claude-sonnet-5"),

  dataDir: path.resolve(optional("DATA_DIR", "./data")),
  outDir: path.resolve(optional("OUT_DIR", "./out")),

  // --- Instagram Graph API ("Instagram API with Instagram Login") ---
  igUserId: optional("IG_USER_ID"),
  igAccessToken: optional("IG_ACCESS_TOKEN"),
  // Version gegen die aktuelle Meta-Doku pruefen (siehe SPEC.md)
  igApiVersion: optional("IG_API_VERSION", "v23.0"),
  // Oeffentliche Basis-URL des Servers (ohne Slash am Ende). Instagram laedt
  // die Bilder von <PUBLIC_BASE_URL>/media/<token>/<n>.jpg.
  publicBaseUrl: optional("PUBLIC_BASE_URL").replace(/\/+$/, ""),
  schedulerIntervalSec: parseInt(optional("SCHEDULER_INTERVAL_SEC", "60"), 10),
  commentPollMinutes: parseInt(optional("COMMENT_POLL_MINUTES", "15"), 10),

  // --- Taeglicher Deck-Post (Entwuerfe aus Archidekt) ---
  dailyDecks: optional("DAILY_DECKS", "false") === "true",
  dailyPostHour: parseInt(optional("DAILY_POST_HOUR", "19"), 10),
  dailyLookaheadDays: parseInt(optional("DAILY_LOOKAHEAD_DAYS", "3"), 10),
  dailyBudgetMaxEur: parseFloat(optional("DAILY_BUDGET_MAX_EUR", "250")),
  dailyStory: optional("DAILY_STORY", "true") === "true",
  archidektOwnUsername: optional("ARCHIDEKT_OWN_USERNAME", "floating.mana"),
};

export function instagramConfigured(): boolean {
  return Boolean(config.igUserId && config.igAccessToken && config.publicBaseUrl);
}

export function requireAnthropicConfigured(): void {
  if (!config.anthropicApiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY missing (.env) - LLM text generation not possible"
    );
  }
}
