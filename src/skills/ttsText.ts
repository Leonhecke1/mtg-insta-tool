/**
 * Text fuer die Sprachausgabe (Piper) aufbereiten, ohne den Inhalt zu aendern.
 * Kostenlos und regelbasiert, laeuft vor jeder Sprachaufnahme:
 *  - Abkuerzungen und Zeichen sprechbar machen (ETB, MV, %, x2, 1st ...)
 *  - Klammern, Gedankenstriche, Auslassungen in natuerliche Pausen umwandeln
 *  - lange Saetze an Bindewoertern teilen (Piper macht nach jedem Satz eine Pause)
 *  - GROSSSCHRIFT entschaerfen, damit nichts buchstabiert wird
 * Eigene Aussprache-Regeln (Optionen -> Aussprache) laufen vorher und haben Vorrang.
 */

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bETB(s)?\b/g, "enters the battlefield"],
  [/\bLTB\b/g, "leaves the battlefield"],
  [/\bEDH\b/g, "E D H"],
  [/\bCMC\b|\bMV\b/g, "mana value"],
  [/\bP\/T\b/g, "power and toughness"],
  [/\bGY\b/g, "graveyard"],
  [/\be\.g\./gi, "for example"],
  [/\bi\.e\./gi, "that is"],
  [/\bvs\.?(?=\s)/gi, "versus"],
  [/\bapprox\.?(?=\s)/gi, "about"],
  [/\betc\./gi, "and so on"],
  [/(\d+)\s?%/g, "$1 percent"],
  [/\bx(\d+)\b/g, "times $1"],
  [/\b(\d+)x\b/g, "$1 times"],
  [/\b1st\b/g, "first"],
  [/\b2nd\b/g, "second"],
  [/\b3rd\b/g, "third"],
  [/\b(\d+)th\b/g, "$1th"],
];

/** Woerter, an denen ein zu langer Satz geteilt werden darf (", and ..." -> ". And ...") */
const SPLIT_AT = /,\s+(and then|and|then|but|so|because|while|until|which means)\s+/gi;
// Erst sehr lange Saetze teilen: zu viele kurze Saetze klingen abgehackt
const MAX_SENTENCE = 170;

function splitLong(sentence: string): string[] {
  if (sentence.length <= MAX_SENTENCE) return [sentence];
  // Trennstelle, die der Satzmitte am naechsten liegt
  const mid = sentence.length / 2;
  let best: { at: number; len: number; word: string } | undefined;
  for (const m of sentence.matchAll(SPLIT_AT)) {
    const at = m.index ?? 0;
    if (at < 25 || sentence.length - at < 25) continue; // keine Mini-Saetze
    if (!best || Math.abs(at - mid) < Math.abs(best.at - mid)) best = { at, len: m[0].length, word: m[1] };
  }
  if (!best) {
    if (sentence.length <= 220) return [sentence]; // Kommas reichen als Pause
    // Notfalls am mittleren Komma teilen
    const commas = [...sentence.matchAll(/,\s+/g)].map((m) => m.index ?? 0).filter((i) => i > 30 && sentence.length - i > 30);
    if (!commas.length) return [sentence];
    const at = commas.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a));
    const rest = sentence.slice(at).replace(/^,\s+/, "");
    return [...splitLong(sentence.slice(0, at) + "."), ...splitLong(rest.charAt(0).toUpperCase() + rest.slice(1))];
  }
  const head = sentence.slice(0, best.at) + ".";
  const word = best.word.toLowerCase() === "and then" ? "Then" : best.word.charAt(0).toUpperCase() + best.word.slice(1).toLowerCase();
  const tail = `${word} ${sentence.slice(best.at + best.len)}`;
  return [...splitLong(head), ...splitLong(tail)];
}

export function optimizeForSpeech(text: string): string {
  // Kommazahlen schuetzen ("4.5" -> "4 point 5"), sonst wird daran der Satz geteilt
  let t = text.replace(/(\d)\.(\d)/g, "$1 point $2");
  for (const [re, rep] of ABBREVIATIONS) t = t.replace(re, rep);
  t = t
    // Klammern: als eingeschobene Pause sprechen
    .replace(/\s*\(([^)]*)\)/g, ", $1,")
    // Gedankenstriche und Auslassungspunkte -> kurze Pause
    .replace(/\s+[—–-]\s+/g, ", ")
    .replace(/(?:…|\.{3})\s+(?=[A-Z])/g, ". ")
    .replace(/…|\.{3}/g, ",")
    // Doppelpunkt als kurze Pause (Komma) statt Satzende, sonst klingt es abgehackt
    .replace(/:\s+/g, ", ")
    // GROSSSCHRIFT (ausser kurzen Abkuerzungen) normal sprechen
    .replace(/\b[A-Z]{5,}\b/g, (w) => w.charAt(0) + w.slice(1).toLowerCase())
    // Satzzeichen aufraeumen
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/;\s*/g, ". ")
    .replace(/\s+/g, " ")
    .trim();

  // In Saetze zerlegen und lange Saetze teilen
  const sentences = t.match(/[^.!?]+[.!?]*/g) ?? [t];
  return sentences
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => splitLong(/[.!?]$/.test(s) ? s : s + "."))
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}
