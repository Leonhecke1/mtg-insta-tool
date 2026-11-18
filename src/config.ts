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
  anthropicModel: optional("ANTHROPIC_MODEL", "claude-haiku-5-5"),

  dataDir: path.resolve(optional("DATA_DIR", "./data")),
  outDir: path.resolve(optional("OUT_DIR", "./out")),

  // --- Instagram Graph API ("Instagram API with Instagram Login") ---
  igUserId: optional("IG_USER_ID"),
  igAccessToken: optional("IG_ACCESS_TOKEN"),
  // Version gegen die aktuelle Meta-Doku pruefen (siehe SPEC.md)
  igApiVersion: optional("IG_API_VERSION", "v23.0"),
  // graph.facebook.com fuer Systemnutzer-Tokens ("API setup with Unified login",
  // laufen nie ab), graph.instagram.com fuer Tokens aus "Instagram Login"
  // (laufen nach 60 Tagen ab und werden automatisch verlaengert)
  igGraphHost: optional("IG_GRAPH_HOST", "graph.facebook.com"),
  // Oeffentliche Basis-URL des Servers (ohne Slash am Ende). Instagram laedt
  // die Bilder von <PUBLIC_BASE_URL>/media/<token>/<n>.jpg.
  publicBaseUrl: optional("PUBLIC_BASE_URL").replace(/\/+$/, ""),
  schedulerIntervalSec: parseInt(optional("SCHEDULER_INTERVAL_SEC", "60"), 10),
  commentPollMinutes: parseInt(optional("COMMENT_POLL_MINUTES", "15"), 10),
  // Antworten auf Kommentare unter eigenen Posts automatisch freigeben
  // (nach einer Wartezeit, in der man in /queue.html noch ablehnen kann)
  autoReply: optional("AUTO_REPLY", "false") === "true",
  autoReplyDelayMin: parseInt(optional("AUTO_REPLY_DELAY_MIN", "10"), 10),
  // Kommentare, die das LLM als Spam/Bot erkennt, automatisch ausblenden
  autoHideSpam: optional("AUTO_HIDE_SPAM", "true") === "true",

  // --- Voice-over fuer Reels (Piper, lokal und kostenlos) ---
  piperBin: optional("PIPER_BIN"),
  piperModel: optional("PIPER_MODEL"),
  // Pause nach jedem Satz (Sekunden) und Sprechtempo (>1 = langsamer)
  piperSentenceSilence: parseFloat(optional("PIPER_SENTENCE_SILENCE", "0.25")),
  piperLengthScale: parseFloat(optional("PIPER_LENGTH_SCALE", "1.05")),

  // --- Alternative Stimme: Nari Labs Dia (natuerlicher, braucht Python + viel RAM/GPU) ---
  // TTS_ENGINE=dia aktiviert Dia; bei Fehler/Timeout faellt es auf Piper zurueck.
  ttsEngine: optional("TTS_ENGINE", "piper"),
  diaPython: optional("DIA_PYTHON", "python3"),
  // Stimmvorlage (WAV + gleichnamige .txt). Fehlt die Datei, wird die erste Aufnahme dort gespeichert.
  diaVoicePrompt: optional("DIA_VOICE_PROMPT"),
  diaSeed: parseInt(optional("DIA_SEED", "42"), 10),
  // Max. Dauer fuer alle Sprachaufnahmen eines Reels (Minuten); CPU ist langsam
  diaTimeoutMin: parseFloat(optional("DIA_TIMEOUT_MIN", "20")),

  // --- VoiceStudio (github.com/debpalash/VoiceStudio, lokal per Docker) ---
  // TTS_ENGINE=voicestudio; OpenAI-kompatibler Endpunkt /v1/audio/speech
  voiceStudioUrl: optional("VOICESTUDIO_URL", "http://127.0.0.1:3900"),
  voiceStudioModel: optional("VOICESTUDIO_MODEL", "omnivoice"),
  // Stimmprofil-ID oder -Name aus VoiceStudio (z. B. eine geklonte/entworfene Stimme)
  voiceStudioVoice: optional("VOICESTUDIO_VOICE", "default"),
  // nur noetig, wenn VoiceStudio nicht auf demselben Rechner (loopback) laeuft
  voiceStudioApiKey: optional("VOICESTUDIO_API_KEY"),
  voiceStudioSpeed: parseFloat(optional("VOICESTUDIO_SPEED", "1.0")),
  // Sprechstil, z. B. "friendly, energetic, conversational"
  voiceStudioInstructions: optional("VOICESTUDIO_INSTRUCTIONS"),
  voiceStudioTimeoutSec: parseFloat(optional("VOICESTUDIO_TIMEOUT_SEC", "300")),

  // --- Taeglicher Deck-Post (Entwuerfe aus Archidekt) ---
  dailyDecks: optional("DAILY_DECKS", "false") === "true",
  dailyPostHour: parseInt(optional("DAILY_POST_HOUR", "19"), 10),
  dailyLookaheadDays: parseInt(optional("DAILY_LOOKAHEAD_DAYS", "3"), 10),
  dailyBudgetMaxEur: parseFloat(optional("DAILY_BUDGET_MAX_EUR", "250")),
  dailyStory: optional("DAILY_STORY", "true") === "true",
  // Wochentage, an denen statt Carousel ein Reel kommt, z. B. "di,fr" (0 = So)
  dailyReelDays: parseWeekdays(optional("DAILY_REEL_DAYS", "")),
  archidektOwnUsername: optional("ARCHIDEKT_OWN_USERNAME", "floating.mana"),
};

function parseWeekdays(s: string): number[] {
  const names: Record<string, number> = {
    so: 0, sun: 0, mo: 1, mon: 1, di: 2, tue: 2, mi: 3, wed: 3, do: 4, thu: 4, fr: 5, fri: 5, sa: 6, sat: 6,
  };
  return s
    .split(/[\s,;]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .map((t) => (/^\d$/.test(t) ? +t : names[t.slice(0, 3)] ?? names[t.slice(0, 2)]))
    .filter((n): n is number => typeof n === "number" && n >= 0 && n <= 6);
}

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
