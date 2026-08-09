import { RawCardRef, RawDeckList } from "../types";

const COMMANDER_LINE = /^\s*commander\s*:\s*(.+)$/i;
// "Sideboard" ist bei Commander-Decks meist der eigentliche Ort fuer
// Upgrade-Kandidaten (echte Sideboards gibt es im Format nicht) - wird wie
// "Maybeboard" behandelt und in denselben Pool gesammelt.
const MAYBEBOARD_HEADER = /^\s*(maybeboard|maybe\s*board|considering|sideboard)\s*:?\s*$/i;
const MAINBOARD_HEADER = /^\s*(mainboard|deck|main\s*deck)\s*:?\s*$/i;
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
 * "Commander:"-Zeile (mehrfach fuer Partner/Background-Commander),
 * "Sideboard"/"Maybeboard" als Synonyme fuer den Upgrade-Kandidaten-Pool,
 * optionales "x" nach der Anzahl und gaengige Set-Code/Foil-Anhaenge aus
 * Moxfield/Archidekt-Exporten.
 */
export function parseRawDecklist(text: string): RawDeckList {
  const lines = text.split(/\r?\n/);

  const commanderNames: string[] = [];
  const mainboard: RawCardRef[] = [];
  const maybeboard: RawCardRef[] = [];

  const addCommander = (name: string) => {
    if (!commanderNames.some((c) => c.toLowerCase() === name.toLowerCase())) {
      commanderNames.push(name);
    }
  };

  let section: "main" | "maybe" = "main";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const commanderMatch = line.match(COMMANDER_LINE);
    if (commanderMatch) {
      addCommander(cleanCardName(commanderMatch[1]).name);
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

    const cardMatch = line.match(CARD_LINE);
    if (!cardMatch) {
      // Freitext-Header wie "Creatures (24)" - ignorieren
      continue;
    }

    const quantity = parseInt(cardMatch[1], 10);
    const { name, isCommander } = cleanCardName(cardMatch[2]);
    if (!name) continue;

    if (isCommander) {
      addCommander(name);
      continue;
    }

    if (section === "maybe") {
      maybeboard.push({ name, quantity });
    } else {
      mainboard.push({ name, quantity });
    }
  }

  if (commanderNames.length === 0) {
    throw new Error(
      'Kein Commander gefunden. Erwartet eine Zeile "Commander: <Name>" (mehrfach bei Partner/Background) oder "*CMDR*"-Markierung.'
    );
  }

  return {
    commanders: commanderNames.map((name) => ({ name, quantity: 1 })),
    mainboard,
    maybeboard,
  };
}
