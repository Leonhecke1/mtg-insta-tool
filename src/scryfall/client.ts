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
const NAMED_URL = "https://api.scryfall.com/cards/named";
const MAX_RETRIES = 3;
const SCRYFALL_HEADERS = {
  // Scryfall verlangt einen eindeutigen User-Agent + Accept-Header
  // (https://scryfall.com/docs/api), sonst kommt ein 400 "generic_user_agent".
  "User-Agent": "mtg-insta-tool/0.1 (+https://github.com/)",
  Accept: "application/json",
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

// 5xx = transiente Scryfall-Ausfaelle; 429 = Rate-Limit (auch transient,
// mit Backoff erneut versuchen); alle anderen 4xx sind endgueltig.
function isRetryableStatus(status: number | undefined): boolean {
  return !status || status === 429 || status >= 500;
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
        headers: { "Content-Type": "application/json", ...SCRYFALL_HEADERS },
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
      if (!isRetryableStatus(status) || attempt === MAX_RETRIES - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastErr;
}

/**
 * Fallback fuer den Fall, dass der Collection-Batch-Endpoint selbst
 * (nicht nur einzelne Karten) laengere Zeit 5xx liefert - kam in der
 * Praxis vor (Scryfall "Application Error" auf POST /cards/collection,
 * waehrend GET-Endpoints normal liefen). Holt Karten einzeln per
 * GET /cards/named nach, langsamer aber robuster.
 */
async function fetchNamedIndividually(
  names: string[]
): Promise<{ data: ScryfallCard[]; notFound: string[] }> {
  const data: ScryfallCard[] = [];
  const notFound: string[] = [];

  for (const name of names) {
    let lastErr: unknown;
    let ok = false;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`${NAMED_URL}?exact=${encodeURIComponent(name)}`, {
          headers: SCRYFALL_HEADERS,
        });
        if (res.status === 404) {
          notFound.push(name);
          ok = true;
          break;
        }
        if (!res.ok) {
          const err = new Error(`Scryfall ${res.status} bei /cards/named (${name})`) as Error & {
            status?: number;
          };
          err.status = res.status;
          throw err;
        }
        data.push((await res.json()) as ScryfallCard);
        ok = true;
        break;
      } catch (err) {
        lastErr = err;
        const status = (err as { status?: number })?.status;
        if (!isRetryableStatus(status) || attempt === MAX_RETRIES - 1) break;
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
    if (!ok) throw lastErr;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  return { data, notFound };
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

    let cards: ScryfallCard[];
    let batchNotFound: string[];
    try {
      const data = await postCollectionWithRetry(identifiers);
      cards = data.data;
      batchNotFound = data.not_found.map((nf) => nf.name).filter((n): n is string => !!n);
    } catch (err) {
      console.warn(
        "[scryfall] Batch-Endpoint dauerhaft fehlgeschlagen, weiche auf Einzelabfragen aus:",
        err instanceof Error ? err.message : err
      );
      const fallback = await fetchNamedIndividually(batch);
      cards = fallback.data;
      batchNotFound = fallback.notFound;
    }

    for (const card of cards) {
      found.set(card.name.toLowerCase(), card);
    }
    notFound.push(...batchNotFound);

    // Scryfall bittet um ~50-100ms zwischen Requests; Batch-Endpoint ist
    // laut SPEC unkritisch, aber ein kleiner Puffer schadet nicht.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return { found, notFound };
}
