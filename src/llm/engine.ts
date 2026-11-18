import { Deck, EnrichedCard } from "../types";

/**
 * Die "Engine" eines Decks: Karten, die nachvollziehbar mit dem Commander
 * zusammenspielen, jeweils mit einem Satz, WARUM.
 *
 * Statt gemeinsame Stichwoerter zu zaehlen (trifft fast jede Karte), wird je
 * Mechanik geprueft:
 *  - Der Commander BELOHNT eine Mechanik (z. B. "whenever a creature dies")
 *      -> Karten, die sie LIEFERN, sind Engine (Opferausgang)
 *  - Der Commander LIEFERT eine Mechanik (z. B. erzeugt Tokens)
 *      -> Karten, die sie BELOHNEN, sind Engine (Token-Payoff)
 *  - Karten, die die Mechanik VERDOPPELN, sind am staerksten
 * Gibt es keine echte Verbindung, kommen lieber weniger Karten als Fuellmaterial.
 */

interface Mechanic {
  id: string;
  /** Karte liefert die Mechanik */
  makes: RegExp;
  /** Karte belohnt die Mechanik */
  cares: RegExp;
  /** Karte verdoppelt die Mechanik */
  doubles?: RegExp;
  /** Verbphrasen (ohne Kartennamen) */
  makesWhy: string;
  caresWhy: string;
  doublesWhy?: string;
}

const MECHANICS: Mechanic[] = [
  {
    id: "tokens",
    makes: /create[^.]*\btokens?\b/i,
    cares: /whenever (?:a|one or more|another)[^.]*(?:tokens?|creatures?)[^.]*(?:enters|enter the battlefield)|for each creature you control|creatures you control get \+/i,
    doubles: /twice that many|create twice|tokens would be created[^.]*instead/i,
    makesWhy: "keeps making extra tokens",
    caresWhy: "rewards you for every creature that hits the battlefield",
    doublesWhy: "doubles every single token you make",
  },
  {
    id: "sacrifice",
    makes: /sacrifice (?:a|an|another)[^.:]{0,40}:/i,
    cares: /whenever you sacrifice/i,
    makesWhy: "lets you sacrifice things whenever you want",
    caresWhy: "gets value every time you sacrifice something",
  },
  {
    id: "death",
    makes: /sacrifice (?:a|an|another)[^.:]{0,40}:|sacrifice (?:a|another) (?:creature|permanent)/i,
    cares: /whenever [^.]*(?:creatures?|permanents?)[^.]*(?:dies|\bdie\b|is put into a graveyard)/i,
    doubles: /dies[^.]*triggers? an additional time/i,
    makesWhy: "lets you sacrifice creatures whenever you want",
    caresWhy: "gets value every time one of your creatures dies",
    doublesWhy: "makes every death trigger twice",
  },
  {
    id: "counters",
    // nur Zaehlmarken auf ANDERE Kreaturen (Carrion Feeder auf sich selbst zaehlt nicht)
    makes: /put (?:a|an|one|two|three|x|that many|\w+) [^.]*\+1\/\+1 counters? on (?:target|each|another|up to|that creature|each other)/i,
    cares: /whenever (?:one or more )?\+1\/\+1 counters? (?:is|are) put|for each \+1\/\+1 counter|with (?:a|one or more) \+1\/\+1 counters?|creatures? you control with counters/i,
    doubles: /twice that many[^.]*counters|counters would be put[^.]*(?:twice|plus one|additional)|that many plus one/i,
    makesWhy: "spreads +1/+1 counters around",
    caresWhy: "gets better with every counter you place",
    doublesWhy: "adds extra counters every time you place some",
  },
  {
    id: "spells",
    makes: /(?:instant|sorcery|noncreature)[^.]*spells?[^.]*cost \{\d\} less|copy target (?:instant|sorcery)|copy that spell|instant and sorcery spells you cast cost/i,
    cares: /whenever you cast (?:an?|your)[^.]*(?:instant|sorcery|noncreature|spell)|magecraft|prowess/i,
    makesWhy: "makes your spells cheaper or copies them, so you can chain more of them",
    caresWhy: "triggers every time you cast a spell",
  },
  {
    id: "graveyard",
    makes: /\bmill\b|put the top [^.]* into your graveyard|surveil|discard (?:a|two|three|x|\w+) cards?,? then draw|draw[^.]*then discard/i,
    cares: /from your graveyard|cards? in your graveyard|\bflashback\b|\bescape\b|\bunearth\b|\bdelirium\b|\bthreshold\b/i,
    makesWhy: "fills up your graveyard",
    caresWhy: "turns your graveyard into a second hand",
  },
  {
    id: "lands",
    makes: /play an additional land|search your library for (?:a|up to \w+|two)[^.]*lands?[^.]*battlefield|put (?:a|up to \w+) land cards? from your hand onto the battlefield/i,
    cares: /\blandfall\b|whenever a land(?: you control)? enters/i,
    doubles: /landfall[^.]*additional time|land entering[^.]*triggers? an additional time/i,
    makesWhy: "puts extra lands into play",
    caresWhy: "triggers on every land you play",
    doublesWhy: "makes every landfall trigger twice",
  },
  {
    id: "artifacts",
    makes: /create[^.]*(?:treasure|clue|food|blood|artifact)[^.]*tokens?/i,
    cares: /whenever (?:an?|another|one or more)[^.]*artifacts?[^.]*(?:enters|enter the battlefield)|for each artifact you control|\baffinity\b|\bimprovise\b/i,
    makesWhy: "keeps pumping out artifact tokens",
    caresWhy: "gets value from every artifact you play",
  },
  {
    id: "attack",
    makes: /additional combat phase|can't be blocked|double strike|creatures you control (?:have|gain) haste/i,
    cares: /whenever[^.]*(?:attacks|deals combat damage to (?:a player|an opponent))/i,
    makesWhy: "gets your creatures through for more attacks",
    caresWhy: "rewards you every time you attack",
  },
  {
    id: "lifegain",
    makes: /\blifelink\b|you gain \d+ life|gain (?:that much|x) life/i,
    cares: /whenever you gain life/i,
    makesWhy: "gains you life over and over",
    caresWhy: "turns every bit of life gain into value",
  },
  {
    id: "etb",
    makes: /exile[^.]*(?:then )?return (?:it|that card|them|those cards) to the battlefield/i,
    cares: /when(?:ever)? [^.]*enters(?: the battlefield)?/i,
    doubles: /triggers? an additional time/i,
    makesWhy: "flickers your creatures so their enter effects happen again",
    caresWhy: "has an enter effect worth repeating",
    doublesWhy: "makes every enter trigger happen twice",
  },
  {
    id: "draw",
    makes: /draw (?:two|three|x|that many) cards|each player draws|draw a card for each/i,
    cares: /whenever you draw|for each card you've drawn|second card each turn/i,
    makesWhy: "draws you a pile of cards",
    caresWhy: "triggers off every card you draw",
  },
];

const shortName = (n: string) => n.split(",")[0].split(" // ")[0].trim();
const isLand = (c: EnrichedCard) => /\bLand\b/.test(c.typeLine);

export interface EnginePiece {
  card: EnrichedCard;
  /** Verbphrase ohne Kartennamen: "lets you sacrifice creatures ..., and every time ... Korvold triggers" */
  why: string;
  mechanic: string;
  score: number;
}

/** Ob der Commander bei der Mechanik ausloest ("whenever ...") oder nur skaliert */
function triggers(cmdText: string, m: Mechanic): boolean {
  return m.cares.test(cmdText) && /whenever|when |at the beginning|landfall|magecraft/i.test(cmdText.match(m.cares)?.[0] ?? cmdText);
}

export function findEngine(deck: Deck, exclude: Set<string>, n = 3): EnginePiece[] {
  if (!deck.commanders.length) return [];
  const cmdName = deck.commanders.map((c) => shortName(c.name)).join(" and ");
  const cmdText = deck.commanders.map((c) => c.oracleText).join("\n");
  const commanderNames = new Set(deck.commanders.map((c) => c.name));
  const cmdCares = MECHANICS.filter((m) => m.cares.test(cmdText));
  const cmdMakes = MECHANICS.filter((m) => m.makes.test(cmdText));

  const pieces: EnginePiece[] = [];
  for (const card of deck.mainboard) {
    if (isLand(card) || commanderNames.has(card.name) || exclude.has(card.name.toLowerCase())) continue;
    const t = card.oracleText;
    let best: EnginePiece | null = null;
    const offer = (p: EnginePiece) => {
      if (!best || p.score > best.score) best = p;
    };
    for (const m of [...cmdCares, ...cmdMakes]) {
      if (m.doubles && m.doublesWhy && m.doubles.test(t))
        offer({ card, mechanic: m.id, score: 7, why: `${m.doublesWhy}, so everything ${cmdName} does counts twice` });
    }
    for (const m of cmdCares) {
      if (m.makes.test(t))
        offer({
          card,
          mechanic: m.id,
          score: 6,
          why: triggers(cmdText, m) ? `${m.makesWhy}, and every time that happens, ${cmdName} triggers` : `${m.makesWhy}, which makes ${cmdName} even stronger`,
        });
    }
    for (const m of cmdMakes) {
      if (m.cares.test(t)) offer({ card, mechanic: m.id, score: 5, why: `${m.caresWhy}, and ${cmdName} keeps feeding it` });
    }
    if (best) pieces.push(best);
  }

  // Beste zuerst; bei Gleichstand die teurere (meist staerkere) Karte. Verschiedene Mechaniken bevorzugen.
  pieces.sort((a, b) => b.score - a.score || (b.card.priceEur ?? 0) - (a.card.priceEur ?? 0));
  const picked: EnginePiece[] = [];
  for (const p of pieces) if (picked.length < n && !picked.some((q) => q.mechanic === p.mechanic && q.score === p.score)) picked.push(p);
  // Gleiche Begruendung doppelt nur, wenn sonst weniger als 2 Karten da waeren
  for (const p of pieces) if (picked.length < Math.min(n, 2) && !picked.includes(p)) picked.push(p);
  return picked;
}
