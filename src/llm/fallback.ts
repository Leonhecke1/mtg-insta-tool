import { Deck, EnrichedCard, GeneratedTexts } from "../types";
import { colorComboName } from "../render/theme";
import { commanderDisplayName, formatEur } from "../render/components";
import { isArtifactOrEnchantment, isCreature, isInstant, isLand, isSorcery, manaValue } from "../render/classify";

/**
 * Regelbasierte Deck-Texte ohne LLM (kostenlos). Liest Archetyp,
 * Schluesselkarten und Deck-Statistik aus Oracle-Texten und Typzeilen ab und
 * fuellt damit Vorlagen. Formulierungen werden pro Commander deterministisch
 * variiert, damit nicht jeder Post gleich klingt. Stilregeln (siehe
 * ~/.claude/instagram/voice.md): konkret, Karten beim Namen, keine
 * Gedankenstriche, keine Emojis.
 */

// ---------------------------------------------------------------------------
// Archetypen
// ---------------------------------------------------------------------------

interface Archetype {
  id: string;
  label: string; // fuer Fliesstext: "a tokens deck"
  hashtag: string;
  test: RegExp; // auf Oracle-Text
  engine: string; // was die Engine tut
  finish: string; // wie das Deck gewinnt
  flavors: string[];
}

const ARCHETYPES: Archetype[] = [
  {
    id: "tokens", label: "go-wide tokens", hashtag: "#tokens",
    test: /create[^.]*token/i,
    engine: "turns every spell into more bodies on the board",
    finish: "an anthem or a mass pump turns the wide board into lethal",
    flavors: ["One became many. Many became an army.", "Count the board. Then count it again."],
  },
  {
    id: "counters", label: "+1/+1 counters", hashtag: "#plusonecounters",
    test: /\+1\/\+1 counter/i,
    engine: "stacks +1/+1 counters every turn and doubles them up",
    finish: "a handful of oversized creatures swing through blockers",
    flavors: ["Small today. Unstoppable by turn eight.", "Every turn, a little bigger."],
  },
  {
    id: "graveyard", label: "graveyard value", hashtag: "#reanimator",
    test: /from (?:your|a) graveyard|mill/i,
    engine: "fills the graveyard and pulls the best threats back out",
    finish: "the same threats keep coming back until the table runs out of answers",
    flavors: ["Death is a resource.", "Nothing here stays buried."],
  },
  {
    id: "aristocrats", label: "aristocrats", hashtag: "#aristocrats",
    test: /sacrifice (?:a|another) creature|whenever (?:a|another) creature (?:you control )?dies/i,
    engine: "sacrifices its own creatures for value and drains on every death",
    finish: "death triggers drain the table one point at a time",
    flavors: ["Every loss is a payment.", "They die. You profit."],
  },
  {
    id: "spellslinger", label: "spellslinger", hashtag: "#spellslinger",
    test: /instant or sorcery|whenever you cast (?:a|your) (?:noncreature|instant)/i,
    engine: "chains instants and sorceries for triggers and card advantage",
    finish: "one big spell turn copies and recasts its way to lethal",
    flavors: ["Words are the sharpest weapon.", "One more spell. Always one more."],
  },
  {
    id: "artifacts", label: "artifacts", hashtag: "#artifacts",
    test: /artifact (?:you control|spell|enters)|whenever an artifact/i,
    engine: "makes artifacts cheap and turns each one into value",
    finish: "the artifact pile becomes an army or a damage engine",
    flavors: ["Gears turn. Engines roar.", "Built, not born."],
  },
  {
    id: "enchantress", label: "enchantress", hashtag: "#enchantress",
    test: /enchantment spell|whenever (?:you cast )?an enchantment/i,
    engine: "draws a card off every enchantment it plays",
    finish: "a fortress of enchantments locks the table out",
    flavors: ["Beauty is a defense.", "Layer upon layer of magic."],
  },
  {
    id: "landfall", label: "landfall", hashtag: "#landfall",
    test: /landfall|whenever a land (?:you control )?enters/i,
    engine: "plays extra lands every turn for repeated landfall triggers",
    finish: "the land drops turn into tokens, damage or huge attackers",
    flavors: ["The ground itself answers the call.", "Every land is a weapon."],
  },
  {
    id: "blink", label: "blink", hashtag: "#blink",
    test: /exile [^.]*, then return (?:it|that card|them) to the battlefield|return (?:it|that card) to the battlefield under/i,
    engine: "flickers its own creatures to reuse enter-the-battlefield effects",
    finish: "repeated ETB value buries the table in card advantage",
    flavors: ["Now you see it. Now you see it again.", "Gone for a moment, back for good."],
  },
  {
    id: "lifegain", label: "lifegain", hashtag: "#lifegain",
    test: /gain[s]? (?:\d+|x|that much) life|whenever you gain life/i,
    engine: "gains life constantly and converts every point into pressure",
    finish: "lifegain triggers turn into counters, drain or a giant threat",
    flavors: ["Life is the longest game.", "Every heartbeat counts."],
  },
  {
    id: "voltron", label: "voltron", hashtag: "#voltron",
    test: /equipped creature|enchanted creature gets|equip \{/i,
    engine: "suits up one creature with equipment and auras",
    finish: "one protected, oversized commander deals 21 commander damage",
    flavors: ["One champion is enough.", "Armor first. Questions later."],
  },
  {
    id: "dragons", label: "dragon tribal", hashtag: "#dragons",
    test: /\bdragons?\b/i,
    engine: "ramps into a flight of dragons as fast as possible",
    finish: "a sky full of dragons ends the game in two swings",
    flavors: ["The sky belongs to them.", "Fire from above."],
  },
];

/** Kurzer Siegschritt fuer die Gameplan-Slide (3. Schritt) */
const STEP_BY_ID: Record<string, string> = {
  tokens: "Pump the army",
  counters: "Swing with giants",
  graveyard: "Recur the threats",
  aristocrats: "Drain the table",
  spellslinger: "Chain the big turn",
  artifacts: "Cash in the pile",
  enchantress: "Lock the table",
  landfall: "Trigger and attack",
  blink: "Out-value everyone",
  lifegain: "Convert life to damage",
  voltron: "21 commander damage",
  dragons: "Burn from the sky",
};

const STAPLES = new Set(
  [
    "Sol Ring", "Arcane Signet", "Command Tower", "Commander's Sphere", "Mind Stone",
    "Swords to Plowshares", "Path to Exile", "Cultivate", "Kodama's Reach", "Rampant Growth",
    "Lightning Greaves", "Swiftfoot Boots", "Exotic Orchard", "Reliquary Tower",
    "Counterspell", "Beast Within", "Chaos Warp", "Evolving Wilds", "Terramorphic Expanse",
  ].map((s) => s.toLowerCase())
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}

function pick<T>(arr: T[], seed: string): T {
  return arr[hash(seed) % arr.length];
}

/**
 * Was eine Karte im Deck tut, als kurze Verbphrase fuer Sprechtext und
 * Bildunterschrift ("Toxrill wipes the board"). Reihenfolge = Prioritaet.
 */
const ROLES: [RegExp, string][] = [
  [/twice that many|double the number|create twice|that many plus one/i, "doubles everything you make"],
  [/(?:destroy|exile) all (?:other )?(?:creatures|nonland)|all creatures get -\d|each creature (?:you don't control )?gets -\d|deals? \d+ damage to each creature/i, "wipes the board"],
  [/extra turn/i, "takes extra turns"],
  [/each opponent loses \d+ life|each opponent loses life/i, "drains the table"],
  [/sacrifice (?:a|another) (?:creature|artifact|permanent):/i, "turns your pieces into value"],
  [/from your graveyard to the battlefield|return (?:target|up to \w+) creature cards? from your graveyard/i, "brings threats back from the graveyard"],
  [/creatures you control get \+\d|other \w+ (?:creatures )?you control get \+\d/i, "pumps the whole team"],
  [/cost \{\d+\} less|costs? \{\d+\} less|spells you cast cost/i, "makes your spells cheaper"],
  [/copy (?:target|that|it)|create a token that's a copy/i, "copies your best threats"],
  [/put (?:a|an additional|that many) \+1\/\+1 counters?|\+1\/\+1 counter on each/i, "spreads +1/+1 counters"],
  [/treasure token/i, "makes Treasure"],
  [/create[^.]*tokens?/i, "makes extra tokens"],
  [/investigate|clue/i, "makes clues"],
  [/mill|put the top [^.]* into your graveyard/i, "fills the graveyard"],
  [/untap (?:target|all|each|up to)/i, "untaps your engine"],
  [/hexproof|indestructible|protection from/i, "protects your key pieces"],
  [/draw (?:a|two|three|four|\w+) cards?|draws? cards? equal/i, "keeps the cards flowing"],
  [/add \{|search your library for (?:a|up to \w+) (?:basic )?land/i, "ramps you ahead"],
  [/(?:destroy|exile) target|deals? \d+ damage to (?:any|target)/i, "removes a problem"],
];

export function cardRole(c: EnrichedCard): string {
  const hit = ROLES.find(([re]) => re.test(c.oracleText));
  if (hit) return hit[1];
  if (isCreature(c)) return "adds pressure on the board";
  if (isInstant(c)) return "answers threats at instant speed";
  return "rounds out the engine";
}

/** Alle "echten" Faehigkeiten des Commanders (keine reinen Keyword-Zeilen), Name gekuerzt. */
function commanderAbilities(c: EnrichedCard): string[] {
  const short = shortName(c.name);
  return c.oracleText
    .split(/\n/)
    .map((l) => stripReminder(l).split(c.name).join(short).replace(/\.$/, ""))
    .filter((l) => l.length > 25);
}

/** "Hakbal of the Surging Soul" bleibt, "Ezrim, Agency Chief" -> "Ezrim" */
export function shortName(name: string): string {
  return name.split(",")[0].split(" // ")[0].trim();
}

function stripReminder(text: string): string {
  return text.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

/** Erste "interessante" Faehigkeit des Commanders (keine reinen Keywords). */
function commanderAbility(c: EnrichedCard): string | null {
  // Zeilenweise aufraeumen, damit Keyword-Zeilen ("Flying") nicht an die
  // eigentliche Faehigkeit geklebt werden
  const lines = c.oracleText
    .split(/\n/)
    .map((l) => stripReminder(l))
    .filter((l) => l.length > 30);
  const line = lines.find((l) => /^(whenever|at the beginning|when|each|you may|creatures|other)/i.test(l)) ?? lines[0];
  if (!line) return null;
  const text = line.replace(/\.$/, "");
  if (text.length <= 200) return text;
  // zu lang: bis zum letzten vollstaendigen Satz unter 200 Zeichen kuerzen
  const cut = text.slice(0, 200).lastIndexOf(". ");
  return cut > 60 ? text.slice(0, cut) : null;
}

const nonLand = (d: Deck) => d.mainboard.filter((c) => !isLand(c));

function countMatching(cards: EnrichedCard[], re: RegExp): number {
  return cards.filter((c) => re.test(c.oracleText)).reduce((n, c) => n + c.quantity, 0);
}

function detectArchetypes(deck: Deck): Archetype[] {
  const pool = [...deck.commanders, ...deck.commanders, ...deck.commanders, ...nonLand(deck)];
  const scored = ARCHETYPES.map((a) => ({ a, score: countMatching(pool, a.test) }))
    .filter((s) => s.score >= 6)
    .sort((x, y) => y.score - x.score);
  return scored.slice(0, 2).map((s) => s.a);
}

function tribe(deck: Deck): { name: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const c of deck.mainboard.filter(isCreature)) {
    const sub = c.typeLine.split("—")[1] ?? c.typeLine.split(" - ")[1];
    for (const t of (sub ?? "").trim().split(/\s+/).filter(Boolean)) {
      counts.set(t, (counts.get(t) ?? 0) + c.quantity);
    }
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 12 ? { name: best[0], count: best[1] } : null;
}

/** Mechaniken, ueber die Commander und Karten zusammenspielen */
const SYNERGY_TERMS: RegExp[] = [
  /artifact/i, /enchantment/i, /token/i, /\+1\/\+1 counter/i, /-1\/-1 counter/i, /counter/i, /graveyard/i,
  /sacrifice/i, /dies/i, /creature spell/i, /instant|sorcery/i, /\bland/i, /draw/i, /gain[s]? life|lifelink/i,
  /attack/i, /equip|equipment/i, /aura/i, /clue|investigate/i, /food/i, /treasure/i, /exile/i, /blink|flicker|return it to the battlefield/i,
  /copy/i, /cast/i, /enters/i, /damage/i, /\bmill/i, /discard/i,
];

/**
 * Schluesselkarten: was am meisten mit dem Commander zusammenspielt.
 * Punkte fuer gemeinsame Mechaniken mit dem Commander-Text, fuer den
 * Archetyp und fuer eine erkannte Rolle; Preis nur als Gleichstand-Brecher.
 * Die drei Karten sollen moeglichst verschiedene Rollen haben.
 */
function keyCardObjs(deck: Deck, arch: Archetype | undefined, n: number): EnrichedCard[] {
  const commanderNames = new Set(deck.commanders.map((c) => c.name));
  const cmdText = deck.commanders.map((c) => c.oracleText).join("\n");
  const cmdTerms = SYNERGY_TERMS.filter((re) => re.test(cmdText));
  const tribeName = tribe(deck)?.name;

  const scored = nonLand(deck)
    .filter((c) => !STAPLES.has(c.name.toLowerCase()) && !commanderNames.has(c.name))
    .map((c) => {
      const shared = cmdTerms.filter((re) => re.test(c.oracleText)).length;
      const archetype = arch && arch.test.test(c.oracleText) ? 1 : 0;
      const tribal = tribeName && new RegExp(`\\b${tribeName}s?\\b`, "i").test(c.oracleText) ? 1 : 0;
      const hasRole = ROLES.some(([re]) => re.test(c.oracleText)) ? 1 : 0;
      const score = shared * 2 + archetype * 3 + tribal * 2 + hasRole + Math.min(1, (c.priceEur ?? 0) / 40);
      return { c, score, role: cardRole(c) };
    })
    .sort((a, b) => b.score - a.score);

  // Erst verschiedene Rollen, dann auffuellen
  const picked: typeof scored = [];
  for (const s of scored) {
    if (picked.length >= n) break;
    if (!picked.some((p) => p.role === s.role)) picked.push(s);
  }
  for (const s of scored) {
    if (picked.length >= n) break;
    if (!picked.includes(s)) picked.push(s);
  }
  return picked.map((p) => p.c);
}

function keyCards(deck: Deck, arch: Archetype | undefined, n: number): string[] {
  return keyCardObjs(deck, arch, n).map((c) => c.name);
}

interface Stats {
  ramp: number;
  draw: number;
  removal: number;
  wipes: number;
  creatures: number;
  spells: number;
}

function stats(deck: Deck): Stats {
  const cards = nonLand(deck);
  return {
    ramp: countMatching(cards, /add \{|search your library for (?:a|up to \w+) (?:basic )?land/i),
    draw: countMatching(cards, /draw (?:a|two|three|\w+) cards?/i),
    removal: countMatching(cards, /(?:destroy|exile) target|deals? \d+ damage to (?:any|target)/i),
    wipes: countMatching(
      cards,
      /(?:destroy|exile) all (?:other )?(?:creatures|nonland permanents|nonland, nontoken permanents|permanents|artifacts|enchantments)|all creatures get -\d|deals? \d+ damage to each creature|return all nonland permanents/i
    ),
    creatures: deck.mainboard.filter(isCreature).reduce((n, c) => n + c.quantity, 0),
    spells: deck.mainboard.filter((c) => isInstant(c) || isSorcery(c)).reduce((n, c) => n + c.quantity, 0),
  };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** ["a","b","c"] -> "a, b and c" */
function listJoin(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function hashtagify(s: string): string {
  return "#" + s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
}

// ---------------------------------------------------------------------------
// Analyse fuer andere Formate (Reel)
// ---------------------------------------------------------------------------

export interface DeckAnalysis {
  name: string; // Kurzname(n) des Commanders
  combo: string; // "Simic"
  style: string; // "Merfolk tribal", "go-wide tokens"
  archetypeId: string | null;
  engine: string | null; // "turns every spell into more bodies on the board"
  finish: string | null;
  ability: string | null;
  /** Alle relevanten Faehigkeiten des (ersten) Commanders */
  abilities: string[];
  keyCards: EnrichedCard[];
  stats: Stats;
  priceEur: number;
  cardCount: number;
  /** Spielplan in 3 kurzen Schritten (wie auf der Gameplan-Slide) */
  steps: [string, string, string];
  /** Anzahl Nicht-Laender je Manawert: Index 0..6, Index 7 = 7+ */
  curve: number[];
  avgManaValue: number;
  counts: { creatures: number; spells: number; permanents: number; lands: number };
  priciest: { name: string; priceEur: number; image: string | null } | null;
}

export function analyzeDeck(deck: Deck): DeckAnalysis {
  const archs = detectArchetypes(deck);
  const main = archs[0];
  const second = archs[1];
  const tr = tribe(deck);
  const fullName = commanderDisplayName(deck.commanders);
  const st = stats(deck);
  const short = deck.commanders.map((c) => shortName(c.name)).join(" & ") || fullName;

  const spells = nonLand(deck);
  const curve = new Array(8).fill(0);
  let mvSum = 0;
  let mvN = 0;
  for (const c of spells) {
    const mv = manaValue(c);
    curve[Math.min(7, mv)] += c.quantity;
    mvSum += mv * c.quantity;
    mvN += c.quantity;
  }
  const qty = (pred: (c: EnrichedCard) => boolean) =>
    deck.mainboard.filter(pred).reduce((n, c) => n + c.quantity, 0);
  const priced = [...deck.mainboard, ...deck.commanders].filter((c) => (c.priceEur ?? 0) > 0);
  const top = priced.sort((a, b) => (b.priceEur ?? 0) - (a.priceEur ?? 0))[0];

  return {
    name: deck.commanders.map((c) => shortName(c.name)).join(" & ") || fullName,
    combo: colorComboName(deck.colorIdentity),
    style: tr ? `${tr.name} tribal` : main ? (second ? `${main.label} with a ${second.label} twist` : main.label) : "midrange value",
    archetypeId: main?.id ?? null,
    engine: main?.engine ?? null,
    finish: main?.finish ?? null,
    ability: deck.commanders[0] ? commanderAbility(deck.commanders[0]) : null,
    abilities: deck.commanders[0] ? commanderAbilities(deck.commanders[0]) : [],
    keyCards: keyCardObjs(deck, main, 3),
    stats: st,
    priceEur: deck.totalPriceEur,
    cardCount: deck.cardCount,
    steps: [
      st.ramp >= 3 ? `Ramp (${st.ramp} sources)` : "Develop the board",
      main ? `Build the ${main.id} engine` : `Deploy ${short}`,
      main ? STEP_BY_ID[main.id] ?? "Close the game" : "Close with the board",
    ],
    curve,
    avgManaValue: mvN ? mvSum / mvN : 0,
    counts: {
      creatures: qty(isCreature),
      spells: qty((c) => isInstant(c) || isSorcery(c)),
      permanents: qty(isArtifactOrEnchantment),
      lands: qty(isLand),
    },
    priciest: top ? { name: top.name, priceEur: top.priceEur ?? 0, image: top.imageNormal } : null,
  };
}

// ---------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------

export function fallbackTexts(deck: Deck): GeneratedTexts {
  const combo = colorComboName(deck.colorIdentity);
  const fullName = commanderDisplayName(deck.commanders);
  const name = deck.commanders.map((c) => shortName(c.name)).join(" & ") || fullName;
  const seed = fullName;

  const archs = detectArchetypes(deck);
  const main = archs[0];
  const second = archs[1];
  const tr = tribe(deck);
  const keys = keyCards(deck, main, 3);
  const st = stats(deck);
  const ability = deck.commanders[0] ? commanderAbility(deck.commanders[0]) : null;
  const price = formatEur(deck.totalPriceEur);

  const style = tr
    ? `${tr.name} tribal`
    : main
    ? second
      ? `${main.label} with a ${second.label} twist`
      : main.label
    : "midrange value";

  // --- Tagline (Cover, max ~90 Zeichen) ---
  const taglines = [
    `${name} leads ${combo} ${style}.`,
    `${combo} ${style}, built around ${name}.`,
    `${name} and a ${style} engine in ${combo}.`,
  ];
  let tagline = pick(taglines, seed + "t");
  if (tagline.length > 90) tagline = `${name}: ${combo} ${style}.`.slice(0, 90);

  // --- Flavor (Badge) ---
  const flavor = main ? pick(main.flavors, seed + "f") : pick(
    ["Patience wins more games than power.", "Every card pulls its weight.", "A plan for every table."],
    seed + "f"
  );

  // --- Gameplan ---
  const p1 = ability
    ? `${name} is the engine: "${ability}." The deck is built so that this triggers as often as possible.`
    : `${name} sits at the center of this ${combo} list, and nearly every card is chosen to support it.`;
  const p2 = main
    ? `The plan is ${style}: the deck ${main.engine}.${keys.length ? ` Key pieces are ${listJoin(keys)}.` : ""}`
    : `It plays a flexible midrange game${keys.length ? ` with ${listJoin(keys)} as the standout cards` : ""}.`;
  const support = [
    st.ramp >= 3 ? plural(st.ramp, "ramp piece") : null,
    st.draw >= 3 ? plural(st.draw, "draw effect") : null,
    st.removal >= 2 ? plural(st.removal, "removal spell") : null,
    st.wipes >= 1 ? plural(st.wipes, "board wipe") : null,
  ].filter((x): x is string => Boolean(x));
  const p3 = `${support.length ? `${listJoin(support)} keep it running. ` : ""}The win: ${
    main ? main.finish : "out-value the table and close with the biggest board"
  }.`;

  const steps: [string, string, string] = [
    st.ramp >= 3 ? `Ramp (${st.ramp} sources)` : "Develop the board",
    main ? `Build the ${main.id} engine` : `Deploy ${name}`,
    main ? STEP_BY_ID[main.id] ?? "Close the game" : "Close with the board",
  ];

  // --- Caption ---
  const openers = [
    ability && ability.length <= 120
      ? `${name}: "${ability}." That one line is the whole deck.`
      : `${name} in ${combo}, built as ${style}.`,
    `${combo} ${style} with ${name} at the helm.`,
    `What happens when ${name} gets a full ${style} shell? This.`,
  ];
  const body = [
    pick(openers, seed + "c"),
    main ? `The deck ${main.engine}${keys.length ? `, with ${keys.slice(0, 2).join(" and ")} doing the heavy lifting` : ""}.` : "",
    `${deck.cardCount} cards, ${price} on Cardmarket.`,
    "Would you sleeve this up? Tell me what you'd swap.",
  ]
    .filter(Boolean)
    .join(" ");

  const hashtags = Array.from(
    new Set(
      [
        "#edh", "#commander", "#mtg",
        hashtagify(deck.commanders[0]?.name ?? name),
        main?.hashtag, tr ? hashtagify(`${tr.name}tribal`) : undefined,
        hashtagify(combo),
      ].filter((h): h is string => Boolean(h) && h !== "#")
    )
  );

  return {
    tagline,
    flavor,
    gameplan: { paragraphs: [p1, p2, p3], steps },
    caption: { body, hashtags },
  };
}
