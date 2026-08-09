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
  // 1 Eintrag normal, 2 bei Partner/Background/Friends-Forever-Commandern
  commanders: RawCardRef[];
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
  // 1 Eintrag normal, 2 bei Partner/Background/Friends-Forever-Commandern
  commanders: EnrichedCard[];
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

export interface CaptionText {
  body: string;
  hashtags: string[];
}

export interface GeneratedTexts {
  tagline: string;
  gameplan: GameplanText;
  caption: CaptionText;
}

export interface GenerateSettings {
  /** Wenn false, werden nur Platzhaltertexte statt LLM-Aufrufen verwendet (schneller Vorschau-Modus) */
  useLlm: boolean;
}

export type SlideKind =
  | "cover"
  | "creatures"
  | "instants"
  | "sorceries"
  | "artifacts"
  | "lands"
  | "gameplan"
  | "price"
  | "upgrades";

export interface GenerateResult {
  jobDir: string;
  slideFiles: string[];
  slideKinds: SlideKind[];
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
    slideKinds: SlideKind[];
    captionFile: string;
    zipFile: string;
    caption?: string;
    usedFallbackNames: string[];
    // Fuer Nachrender bei Text-Bearbeitung (siehe pipeline.ts rerenderDeckTech)
    deck: Deck;
    texts: GeneratedTexts;
    deckSummary?: {
      commander: string;
      cardCount: number;
      totalPriceEur: number;
      colorIdentity: ColorCode[];
    };
  };
  error?: string;
}
