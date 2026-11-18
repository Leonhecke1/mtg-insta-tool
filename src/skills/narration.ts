/**
 * Bausteine fuer gesprochene Reel-Texte, die wie ein Gespraech klingen statt
 * wie aneinandergereihte Stichpunkte: Ueberleitungen zwischen den Szenen,
 * Kartentext in "die Karte macht X" bzw. "du machst X" umformen.
 */

export const lcFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const strip = (s: string) => s.trim().replace(/[.\s]+$/, "");

/** Befehlsform-Verben in Kartentexten und Combo-Schritten */
const VERBS =
  "activate|add|attack|block|cast|choose|copy|counter|create|deal|destroy|discard|double|draw|equip|exile|gain|look|mill|move|pay|play|put|remove|repeat|return|reveal|sacrifice|scry|search|shuffle|tap|untap|use|hold|respond|resolve|trigger|enchant|flip|reanimate|loot|surveil|proliferate|fetch|tutor|bounce|give";
const VERB_RE = new RegExp(`^(${VERBS})\\b`, "i");

/** "untap" -> "untaps", "copy" -> "copies", "search" -> "searches" */
function thirdPerson(verb: string): string {
  const v = verb.toLowerCase();
  if (/[^aeiou]y$/.test(v)) return v.slice(0, -1) + "ies";
  if (/(s|sh|ch|x|z)$/.test(v)) return v + "es";
  return v + "s";
}

/**
 * Kartentext als Nebensatz zur Karte:
 *  "Untap all nonland permanents you control" -> "which untaps all nonland permanents you control"
 *  "You may copy the exiled card"             -> "which lets you copy the exiled card"
 *  "Whenever you cast ..., ..."               -> null (passt nicht als Nebensatz)
 */
export function asWhichClause(text: string): string | null {
  const t = strip(text);
  const may = t.match(/^you may (.+)$/i);
  if (may) return `which lets you ${may[1]}`;
  const m = t.match(VERB_RE);
  if (m && !/[:{]/.test(t.slice(0, 40))) return `which ${thirdPerson(m[1])}${t.slice(m[1].length)}`;
  return null;
}

/** Combo-Schritt als "du"-Satz: "Activate Scepter ..." -> "you activate Scepter ..." */
export function asYouClause(step: string): string {
  const t = strip(step);
  if (VERB_RE.test(t)) return `you ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  // "When the land enters ..." nach einer Ueberleitung klein; Kartennamen bleiben gross
  return /^(when|whenever|if|as|once|after)\b/i.test(t) ? lcFirst(t) : t;
}

export const startsWithVerb = (s: string) => VERB_RE.test(s.trim());

/** Aktivierte Faehigkeit "{2}, {T}: You may copy ..." -> Effekt-Teil, sonst null */
export function activatedEffect(text: string): string | null {
  const m = text.match(/^[^.]*?(?:\{[^}]+\}|\btap\b|\bsacrifice\b)[^.:]*:\s*(.+)$/i);
  return m ? m[1] : null;
}

/** Satz sauber beenden */
export const end = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
