/**
 * Port von caption.py (/ig-caption) aus dem "instagram-agent-skill" von
 * Jake Schincariol, MIT-Lizenz (siehe data/LICENSE-instagram-agent-skill).
 *
 * Zeigt, was der Feed vor dem "... mehr" zeigt (~125 Zeichen), und prueft die
 * Punkte, die sich zu pruefen lohnen: Laenge, erste Zeile, konkreter Hook,
 * Hashtags (max. 5 seit Dez. 2025), Links, genau eine Aufforderung, Emoji-Dichte,
 * Suchbegriffe.
 */

export const CAPTION_LIMIT = 2200;
export const TRUNCATE = 125;
export const HASHTAG_LIMIT = 5;

const HASHTAG_RE = /(?:^|\s)(#[A-Za-z0-9_]+)/g;
const LINK_RE = /https?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(?:com|co|io|net|org|ai|app)\/\S*/gi;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}☀-➿←-⇿️]/gu;
const CONCRETE_RE = /[$€]\s?\d|\b\d[\d,.]*\b|(?<!^)\b[A-Z][a-z]{2,}\b/gm;

const ASKS: [RegExp, string][] = [
  [/\bcomment (?:the word |")?[A-Z0-9]{2,}\b/i, "Keyword kommentieren"],
  [/\b(?:dm|message) me\b/i, "DM"],
  [/\bsave (?:this|it)\b/i, "speichern"],
  [/\bshare (?:this|it)\b/i, "teilen"],
  [/\bfollow (?:me|for)\b/i, "folgen"],
  [/\blink in (?:my )?bio\b/i, "Link in Bio"],
  [/\b(?:swipe|tap) (?:through|left|right|for|to)\b/i, "wischen/tippen"],
  [/\btell me\b|\bwhat would you\b|\bwhich one\b/i, "Frage beantworten"],
];

const FILLER_TAGS = new Set([
  "#viral", "#fyp", "#explore", "#explorepage", "#foryou", "#foryoupage", "#trending", "#instagood",
  "#love", "#follow", "#like4like", "#reels", "#reelsinstagram", "#viralreels", "#instadaily",
]);

export type CheckStatus = "PASS" | "WARN" | "FAIL";
export interface CaptionLint {
  characters: number;
  visible: string;
  truncated: boolean;
  hashtags: string[];
  asks: string[];
  checks: { check: string; status: CheckStatus; detail: string }[];
  verdict: "READY" | "REVIEW" | "FIX";
}

export function lintCaption(text: string, keywords: string[] = []): CaptionLint {
  const stripped = text.trim();
  const chars = stripped.length;
  const firstLine = (stripped.split("\n")[0] ?? "").trim();
  const tags = [...stripped.matchAll(HASHTAG_RE)].map((m) => m[1]);
  const links = stripped.match(LINK_RE) ?? [];
  const emoji = stripped.match(EMOJI_RE) ?? [];
  const visible = chars <= TRUNCATE ? stripped : stripped.slice(0, TRUNCATE);
  const asks = ASKS.filter(([re]) => re.test(stripped)).map(([, n]) => n);
  const filler = tags.filter((t) => FILLER_TAGS.has(t.toLowerCase()));
  const checks: CaptionLint["checks"] = [];
  const add = (check: string, status: CheckStatus, detail: string) => checks.push({ check, status, detail });

  add("Länge", chars > CAPTION_LIMIT ? "FAIL" : "PASS", `${chars} / ${CAPTION_LIMIT} Zeichen`);

  if (!firstLine) add("Erste Zeile", "FAIL", "beginnt mit einer Leerzeile");
  else if (/^[#@]/.test(firstLine)) add("Erste Zeile", "FAIL", "beginnt mit Hashtag oder Erwähnung, dem wertvollsten Platz");
  else if (firstLine.length > TRUNCATE)
    add("Erste Zeile", "WARN", `${firstLine.length} Zeichen, wird bei ${TRUNCATE} abgeschnitten`);
  else add("Erste Zeile", "PASS", `${firstLine.length} Zeichen, passt ganz in den Feed`);

  const concrete = visible.match(CONCRETE_RE) ?? [];
  add("Konkreter Hook", concrete.length ? "PASS" : "WARN",
    concrete.length ? `${concrete.length} Zahl(en)/Name(n) vor dem „… mehr“` : "nichts Konkretes vor dem „… mehr“");

  if (tags.length > HASHTAG_LIMIT) add("Hashtags", "FAIL", `${tags.length}, Instagram erlaubt seit Dez. 2025 nur ${HASHTAG_LIMIT}`);
  else if (filler.length) add("Hashtags", "WARN", `${filler.length} nichtssagende (${filler.slice(0, 3).join(", ")})`);
  else add("Hashtags", "PASS", `${tags.length}${tags.length ? `: ${tags.join(" ")}` : ""}`);

  if (tags.some((t) => visible.includes(t))) add("Hashtag-Position", "WARN", "Hashtag im sichtbaren Bereich");
  else add("Hashtag-Position", "PASS", tags.length ? "unter dem „… mehr“" : "keine Hashtags");

  add("Links", links.length ? "WARN" : "PASS",
    links.length ? `${links.length} Link(s), in Captions nicht klickbar` : "keine toten Links");

  if (asks.length === 1) add("Eine Aufforderung", "PASS", asks[0]);
  else if (!asks.length) add("Eine Aufforderung", "WARN", "keine Aufforderung, wofür ist der Post?");
  else add("Eine Aufforderung", "WARN", `${asks.length} (${asks.join(", ")}), zwei sind so gut wie keine`);

  const density = (emoji.length * 100) / Math.max(chars, 1);
  add("Emoji", density > 4 ? "WARN" : "PASS", `${emoji.length} Emoji, ${density.toFixed(1)} pro 100 Zeichen`);

  const kws = keywords.map((k) => k.trim()).filter(Boolean);
  if (kws.length) {
    const low = stripped.toLowerCase();
    const found = kws.filter((k) => low.includes(k.toLowerCase()));
    const missing = kws.filter((k) => !found.includes(k));
    add("Suchbegriffe", missing.length ? (found.length ? "WARN" : "FAIL") : "PASS",
      `${found.length}/${kws.length} enthalten${missing.length ? `, fehlt: ${missing.join(", ")}` : ""}`);
  }

  const fails = checks.filter((c) => c.status === "FAIL").length;
  const warns = checks.filter((c) => c.status === "WARN").length;
  return {
    characters: chars,
    visible,
    truncated: chars > TRUNCATE,
    hashtags: tags,
    asks,
    checks,
    verdict: fails ? "FIX" : warns ? "REVIEW" : "READY",
  };
}
