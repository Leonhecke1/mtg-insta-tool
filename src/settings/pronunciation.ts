import * as fs from "fs";
import * as path from "path";
import { config } from "../config";

/**
 * Aussprache-Regeln fuer das Voice-over (Piper). "from" wird im Sprechtext
 * durch "to" ersetzt - Gross/Kleinschreibung egal, laengere Eintraege zuerst.
 * Gilt nur fuer die Stimme, Untertitel zeigen den Originaltext.
 * Bearbeitbar in der App unter Einstellungen -> Aussprache.
 */

export interface PronunciationRule {
  from: string;
  to: string;
}

export const DEFAULT_RULES: PronunciationRule[] = [
  { from: "+1/+1", to: "plus one" },
  { from: "-1/-1", to: "minus one" },
  { from: "+2/+2", to: "plus two" },
  { from: "ETB", to: "enters" },
  { from: "EDH", to: "E D H" },
  { from: "cEDH", to: "competitive E D H" },
  { from: "MV", to: "mana value" },
  { from: "CMC", to: "mana value" },
  { from: "LGS", to: "local game store" },
];

const file = () => path.join(config.dataDir, "pronunciation.json");

export function getRules(): PronunciationRule[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), "utf8"));
    if (Array.isArray(parsed)) return parsed.filter((r) => typeof r?.from === "string" && typeof r?.to === "string");
  } catch {
    /* noch nichts gespeichert */
  }
  return DEFAULT_RULES;
}

export function saveRules(rules: PronunciationRule[]): PronunciationRule[] {
  const clean = rules
    .map((r) => ({ from: String(r.from ?? "").trim(), to: String(r.to ?? "").trim() }))
    .filter((r) => r.from.length > 0)
    .slice(0, 200);
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(clean, null, 2));
  return clean;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Wendet die Regeln auf einen Sprechtext an. */
export function applyPronunciation(text: string, rules = getRules()): string {
  let out = text;
  const valid = rules
    .filter((r) => typeof r?.from === "string" && typeof r?.to === "string" && r.from.trim() !== "")
    .map((r) => ({ from: r.from.trim(), to: r.to.trim() }));
  for (const r of valid.sort((a, b) => b.from.length - a.from.length)) {
    // Wortgrenzen nur dort, wo der Eintrag mit Buchstaben/Ziffern beginnt bzw. endet,
    // damit "MV" nicht in "MVP" greift, "+1/+1" aber trotzdem gefunden wird
    const start = /^[\p{L}\p{N}]/u.test(r.from) ? "(?<![\\p{L}\\p{N}])" : "";
    const end = /[\p{L}\p{N}]$/u.test(r.from) ? "(?![\\p{L}\\p{N}])" : "";
    out = out.replace(new RegExp(start + escapeRe(r.from) + end, "giu"), ` ${r.to} `);
  }
  // Pauschal: "4/4" -> "4 4" (Kraft/Widerstand), damit kein "slash" gesprochen wird
  out = out.replace(/(\d+)\s*\/\s*(\d+)/g, "$1 $2");
  return out.replace(/\s+/g, " ").replace(/\s+([.,!?;:])/g, "$1").trim();
}
