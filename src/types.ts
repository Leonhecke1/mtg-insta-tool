export type ColorCode = "W" | "U" | "B" | "R" | "G";

/**
 * Von Moxfield/Archidekt bereits mitgelieferte Kartendaten. Wird genutzt,
 * wenn Scryfall eine Karte nicht liefern kann (Ausfall oder Name nicht
 * gefunden) - siehe scryfall/enrich.ts.
 */
export interface CardFallbackData {
  manaCost: string;
  typeLine: string;
  oracleText: string;
  colorIdentity: ColorCode[];
  imageNormal: string | null;
  priceEur: number | null;
}

export interface RawCardRef {
  name: string;
  quantity: number;
  fallback?: CardFallbackData;
}

export interface RawDeckList {
  commander: RawCardRef;
  mainboard: RawCardRef[];
  maybeboard: RawCardRef[];
}

export interface EnrichedCard {
  name: string;
  quantity: number;
  manaCost: string;
  typeLine: string;
  oracleText: string;
  colorIdentity: ColorCode[];
  imageNormal: string | null;
  imageArtCrop: string | null;
  priceEur: number | null;
  scryfallId: string;
}

export interface Deck {
  commander: EnrichedCard;
  mainboard: EnrichedCard[];
  maybeboard: EnrichedCard[];
  colorIdentity: ColorCode[];
  totalPriceEur: number;
  cardCount: number;
}

export interface GameplanText {
  paragraphs: string[];
  steps: [string, string, string];
}

export interface UpgradeNote {
  cardName: string;
  oneLiner: string;
}

export interface CaptionText {
  body: string;
  hashtags: string[];
}

export interface GeneratedTexts {
  tagline: string;
  gameplan: GameplanText;
  upgrades: UpgradeNote[];
  caption: CaptionText;
}

export interface GenerateSettings {
  /** Wenn false, werden nur Platzhaltertexte statt LLM-Aufrufen verwendet (schneller Vorschau-Modus) */
  useLlm: boolean;
}

export interface GenerateResult {
  jobDir: string;
  slideFiles: string[];
  captionFile: string;
  caption: string;
  zipFile: string;
  deck: Deck;
  texts: GeneratedTexts;
  notFoundNames: string[];
  usedFallbackNames: string[];
}

export type JobStatus = "generating" | "ready" | "failed";

export interface Job {
  id: string;
  createdAt: string;
  status: JobStatus;
  input: {
    kind: "raw" | "moxfield" | "archidekt";
    raw?: string;
    moxfieldUrl?: string;
    archidektUrl?: string;
  };
  result?: {
    jobDir: string;
    slideFiles: string[];
    captionFile: string;
    zipFile: string;
    caption?: string;
    usedFallbackNames: string[];
    deckSummary?: {
      commander: string;
      cardCount: number;
      totalPriceEur: number;
      colorIdentity: ColorCode[];
    };
  };
  error?: string;
}
