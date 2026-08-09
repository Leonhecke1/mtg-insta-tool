import { RawCardRef, RawDeckList } from "../types";

const COMMANDER_LINE = /^\s*commander\s*:\s*(.+)$/i;
const MAYBEBOARD_HEADER = /^\s*(maybeboard|maybe\s*board|considering)\s*:?\s*$/i;
const MAINBOARD_HEADER = /^\s*(mainboard|deck|main\s*deck)\s*:?\s*$/i;
const SIDEBOARD_HEADER = /^\s*(sideboard)\s*:?\s*$/i;
// "1 Sol Ring", "1x Sol Ring", "1 Sol Ring *CMDR*", "1 Sol Ring (C21) 253"
const CARD_LINE = /^\s*(\d+)\s*x?\s+(.+?)\s*$/i;
const CMDR_SUFFIX = /\s*\*?\bcmdr\b\*?\s*$/i;
// set-code + collector-number tails Moxfield/Archidekt export, e.g. "(CMM) 253", "(cmm) 253 *F*"
const SET_TAIL = /\s*\([a-z0-9]{2,6}\)\s*[a-z0-9\-★]*\s*(\*f\*)?\s*$/i;
const FOIL_TAIL = /\s*\*f\*\s*$/i;

/**
 * Normalisiert eine einzelne Kartenzeile: entfernt CMDR-Marker, Set-Code/
 * Sammelnummer-Anhaenge und Foil-Marker, die Deck-Export-Tools anhaengen.
 */
function cleanCardName(raw: string): { name: string; isCommander: boolean } {
  let name = raw.trim();
  let isCommander = false;

  if (CMDR_SUFFIX.test(name)) {
    isCommander = true;
    name = name.replace(CMDR_SUFFIX, "").trim();
  }

  name = name.replace(SET_TAIL, "").trim();
  name = name.replace(FOIL_TAIL, "").trim();

  return { name, isCommander };
}

/**
 * Parst eine Rohtext-Deckliste (siehe SPEC.md "Eingabe") in ein
 * RawDeckList-Modell. Toleriert deutsche/englische Section-Header,
 * "Commander:"-Zeile, optionale "x" nach der Anzahl und gaengige
 * Set-Code/Foil-Anhaenge aus Moxfield/Archidekt-Exporten.
 */
export function parseRawDecklist(text: string): RawDeckList {
  const lines = text.split(/\r?\n/);

  let commanderName: string | null = null;
  const mainboard: RawCardRef[] = [];
  const maybeboard: RawCardRef[] = [];

  let section: "main" | "maybe" | "side" = "main";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const commanderMatch = line.match(COMMANDER_LINE);
    if (commanderMatch) {
      commanderName = cleanCardName(commanderMatch[1]).name;
      continue;
    }

    if (MAYBEBOARD_HEADER.test(line)) {
      section = "maybe";
      continue;
    }
    if (MAINBOARD_HEADER.test(line)) {
      section = "main";
      continue;
    }
    if (SIDEBOARD_HEADER.test(line)) {
      section = "side";
      continue;
    }

    const cardMatch = line.match(CARD_LINE);
    if (!cardMatch) {
      // Freitext-Header wie "Creatures (24)" - ignorieren
      continue;
    }

    const quantity = parseInt(cardMatch[1], 10);
    const { name, isCommander } = cleanCardName(cardMatch[2]);
    if (!name) continue;

    if (isCommander) {
      commanderName = name;
      continue;
    }

    if (section === "maybe") {
      maybeboard.push({ name, quantity });
    } else if (section === "main") {
      mainboard.push({ name, quantity });
    }
    // "side" (Sideboard) wird fuer EDH-Deck-Techs nicht verwendet
  }

  if (!commanderName) {
    throw new Error(
      'Kein Commander gefunden. Erwartet eine Zeile "Commander: <Name>" oder "*CMDR*"-Markierung.'
    );
  }

  return { commander: { name: commanderName, quantity: 1 }, mainboard, maybeboard };
}
