export type ColorCode = "W" | "U" | "B" | "R" | "G";

export interface RawCardRef {
  name: string;
  quantity: number;
}

export interface RawDeckList {
  commanderName: string;
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
  deck: Deck;
  texts: GeneratedTexts;
  notFoundNames: string[];
}

export type JobStatus =
  | "scheduled"
  | "generating"
  | "ready"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";

export interface PublishJob {
  id: string;
  createdAt: string;
  scheduledAt: string | null; // ISO string; null = sofort/dry-run only
  status: JobStatus;
  dryRun: boolean;
  input: {
    kind: "raw" | "moxfield";
    raw?: string;
    moxfieldUrl?: string;
  };
  result?: {
    jobDir: string;
    slideFiles: string[];
    captionFile: string;
    caption?: string;
    deckSummary?: {
      commander: string;
      cardCount: number;
      totalPriceEur: number;
      colorIdentity: ColorCode[];
    };
  };
  error?: string;
  publishedMediaId?: string;
}
