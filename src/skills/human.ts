/**
 * Port von /ig-human (humanize.py + Struktur-Check aus detect.py) aus dem
 * "instagram-agent-skill" von Jake Schincariol, MIT-Lizenz
 * (siehe lexicon/LICENSE-instagram-agent-skill). Daten: lexicon/slop.json.
 *
 * Entfernt unsichtbare Zeichen, normalisiert Typografie (Gedankenstrich ->
 * Komma ...), ersetzt KI-Floskeln durch einfache Woerter und meldet
 * typische Satzmuster ("It's not just X, it's Y"), die man selbst umschreiben sollte.
 */


import slopJson from "./lexicon/slop.json";

const lex = slopJson as unknown as {
  invisible: { cp: string; name: string; action: "delete" | "space" }[];
  typographic: { from: string; name: string; to: string }[];
  words: { find: string; replace: string; family: string }[];
  phrases: { find: string; replace: string; family: string }[];
  structures: { id: string; regex: string; name: string; fix: string }[];
};

const URL_RE = /https?:\/\/\S+|\bwww\.\S+/gi;

export interface HumanizeReport {
  text: string;
  changes: { kind: "invisible" | "typographic" | "lexical"; what: string; count: number }[];
  /** Muster, die nicht automatisch geaendert werden */
  structures: { name: string; fix: string; match: string }[];
}

function cpToChar(cp: string): string {
  return String.fromCodePoint(parseInt(cp.replace(/^U\+/i, ""), 16));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function matchCase(src: string, repl: string): string {
  if (!repl) return repl;
  if (src.length > 1 && src === src.toUpperCase() && /[A-Z]/.test(src)) return repl.toUpperCase();
  if (/^[A-Z]/.test(src)) return repl[0].toUpperCase() + repl.slice(1);
  return repl;
}

/** Python-Regex aus slop.json ("(?i)...") in ein JS-RegExp uebersetzen */
function pyRegex(src: string): RegExp {
  let flags = "g";
  let body = src;
  const m = body.match(/^\(\?([a-z]+)\)/);
  if (m) {
    if (m[1].includes("i")) flags += "i";
    if (m[1].includes("m")) flags += "m";
    if (m[1].includes("s")) flags += "s";
    body = body.slice(m[0].length);
  }
  return new RegExp(body, flags + "u");
}

const STRUCTURES = lex.structures
  .map((s) => {
    try {
      return { ...s, re: pyRegex(s.regex) };
    } catch {
      return null; // Muster, das JS nicht versteht, ueberspringen
    }
  })
  .filter((s): s is NonNullable<typeof s> => s !== null);

const LEXICAL = [...lex.phrases, ...lex.words]
  .sort((a, b) => b.find.length - a.find.length)
  .map((e) => ({
    ...e,
    re: new RegExp(`\\b${escapeRe(e.find).replace(/\\? /g, "\\s+")}\\b`, "gi"),
  }));

/** MTG-Fachbegriffe, die in slop.json stehen, hier aber richtig sind */
const MTG_TERMS = ["synergy", "synergies", "unleash", "treasure", "treasures", "arsenal"];

/**
 * @param protect Begriffe, die nie veraendert werden (z. B. alle Kartennamen
 *   des Decks: "Beacon of Tomorrows", "Harness by Force" ...)
 */
export function humanize(input: string, protect: string[] = []): HumanizeReport {
  const changes: HumanizeReport["changes"] = [];

  // URLs und geschuetzte Begriffe (laengste zuerst) durch Platzhalter ersetzen
  const urls: string[] = [];
  let text = input.replace(URL_RE, (u) => `\u0000URL${urls.push(u) - 1}\u0000`);
  const terms = [...new Set([...protect, ...MTG_TERMS].filter((t) => t.trim().length >= 3))].sort(
    (a, b) => b.length - a.length
  );
  for (const t of terms) {
    text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(t)}(?![\\p{L}\\p{N}])`, "giu"), (m) => `\u0000URL${urls.push(m) - 1}\u0000`);
  }

  // 1. Unsichtbare Zeichen
  for (const e of lex.invisible) {
    const [a, b] = e.cp.split("-");
    const cls = b ? `[${cpToChar(a)}-${cpToChar(b)}]` : escapeRe(cpToChar(a));
    const re = new RegExp(cls, "gu");
    const n = (text.match(re) ?? []).length;
    if (n) {
      changes.push({ kind: "invisible", what: `${e.cp} ${e.name}`, count: n });
      text = text.replace(re, e.action === "delete" ? "" : " ");
    }
  }
  // restliche Format-Zeichen (ausser unserem URL-Platzhalter)
  text = text.replace(/[\p{Cf}]/gu, "");

  // 2. Typografie
  for (const e of lex.typographic) {
    const n = text.split(e.from).length - 1;
    if (!n) continue;
    changes.push({ kind: "typographic", what: `${e.from} ${e.name}`, count: n });
    if (e.from === "—") text = text.replace(/\s*—\s*/g, ", ");
    else if (e.from === "–") text = text.replace(/\s*–\s*(?=\d)/g, "-").replace(/\s+–\s+/g, ", ").replace(/–/g, "-");
    else text = text.split(e.from).join(e.to);
  }
  text = text.replace(/,\s*([,.;:!?])/g, "$1").replace(/,\s*\n/g, "\n");

  // 3. Floskeln
  for (const e of LEXICAL) {
    let n = 0;
    text = text.replace(e.re, (m) => {
      n++;
      return matchCase(m, e.replace);
    });
    if (n) changes.push({ kind: "lexical", what: e.replace ? `${e.find} → ${e.replace}` : `${e.find} (gelöscht)`, count: n });
  }
  // Aufraeumen nach Loeschungen
  text = text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.;:!?])/g, "$1")
    // verwaiste Satzzeichen ("engine.!" nach geloeschtem "Follow for more!")
    .replace(/([.!?,;:])[ \t]*[.!?]+(?=\s|$)/g, "$1")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .replace(/(^|[.!?]\s+)([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());

  text = text.replace(/\u0000URL(\d+)\u0000/g, (_m, i: string) => urls[+i]);

  const structures = STRUCTURES.flatMap((s) =>
    [...text.matchAll(s.re)].map((m) => ({ name: s.name, fix: s.fix, match: m[0] }))
  );
  return { text, changes, structures };
}
