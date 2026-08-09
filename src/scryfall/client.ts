export interface ScryfallImageUris {
  normal?: string;
  art_crop?: string;
  [key: string]: string | undefined;
}

export interface ScryfallCardFace {
  name?: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  image_uris?: ScryfallImageUris;
}

export interface ScryfallCard {
  id: string;
  name: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  color_identity: string[];
  image_uris?: ScryfallImageUris;
  card_faces?: ScryfallCardFace[];
  prices?: { eur?: string | null };
}

interface CollectionResponse {
  data: ScryfallCard[];
  not_found: { name?: string }[];
}

const BATCH_SIZE = 75;
const API_URL = "https://api.scryfall.com/cards/collection";
const MAX_RETRIES = 3;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function postCollectionWithRetry(
  identifiers: { name: string }[]
): Promise<CollectionResponse> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // WICHTIG: bewusst das native fetch statt axios - axios' Node-HTTP-Client
      // wurde in der Praxis von Scryfalls Cloudflare-Edge mit 503 "Application
      // Error" beantwortet (identische Header/Body ueber fetch/curl liefen
      // problemlos durch). Vermutlich ein TLS/Header-Fingerprinting-Ding auf
      // Scryfall-Seite. Falls das Problem zurueckkommt: hier zuerst pruefen.
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Scryfall verlangt einen eindeutigen User-Agent + Accept-Header
          // (https://scryfall.com/docs/api), sonst kommt ein 400
          // "generic_user_agent".
          "User-Agent": "mtg-insta-tool/0.1 (+https://github.com/)",
          Accept: "application/json",
        },
        body: JSON.stringify({ identifiers }),
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        const err = new Error(
          `Scryfall ${res.status} bei ${API_URL}: ${bodyText.slice(0, 300)}`
        ) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }

      return (await res.json()) as CollectionResponse;
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      // 5xx = transiente Scryfall-Ausfaelle (kommen gelegentlich vor, siehe
      // Heroku "Application Error"); 4xx sofort weiterwerfen, nicht retryen.
      const retryable = !status || status >= 500;
      if (!retryable || attempt === MAX_RETRIES - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastErr;
}

/**
 * Loest eine Liste von Kartennamen ueber den Scryfall Collection-Endpoint
 * auf (max. 75 Identifier/Request, siehe SPEC.md). Gibt eine Map von
 * lowercased-Kartenname -> ScryfallCard zurueck. Namen, die nicht gefunden
 * wurden, landen NICHT in der Map (Aufrufer muss pruefen).
 */
export async function fetchScryfallCards(
  names: string[]
): Promise<{ found: Map<string, ScryfallCard>; notFound: string[] }> {
  const uniqueNames = Array.from(new Set(names));
  const found = new Map<string, ScryfallCard>();
  const notFound: string[] = [];

  for (const batch of chunk(uniqueNames, BATCH_SIZE)) {
    const identifiers = batch.map((name) => ({ name }));
    const data = await postCollectionWithRetry(identifiers);

    for (const card of data.data) {
      found.set(card.name.toLowerCase(), card);
    }
    for (const nf of data.not_found) {
      if (nf.name) notFound.push(nf.name);
    }

    // Scryfall bittet um ~50-100ms zwischen Requests; Batch-Endpoint ist
    // laut SPEC unkritisch, aber ein kleiner Puffer schadet nicht.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return { found, notFound };
}
