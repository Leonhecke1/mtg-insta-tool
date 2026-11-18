import * as fs from "fs";
import * as path from "path";
import { nanoid } from "nanoid";
import { config } from "../config";
import { notify } from "../push/push";
import { getSettings } from "../settings/appSettings";

/**
 * MTG-News aus offiziellen Quellen (kostenlos):
 *  - Scryfall: neue Commander (legendaere Kreaturen) aus kommenden/neuen Sets,
 *    sobald sie offiziell gespoilert sind
 *  - Scryfall: Aenderungen der Commander-Bannliste und der Game-Changer-Liste
 *    (taeglicher Abgleich)
 *  - optionale RSS-Feeds aus den Einstellungen
 * Keine Leaks: nur was offiziell gezeigt wurde.
 */

export type NewsType = "spoiler" | "commander" | "ban" | "unban" | "gamechanger" | "gamechanger_removed" | "article";

export interface SpoilerCard {
  name: string;
  image?: string;
  art?: string;
  colors?: string[];
}

export interface NewsItem {
  id: string;
  type: NewsType;
  title: string;
  body?: string;
  url?: string;
  image?: string; // Kartenbild
  art?: string; // Artwork (Hintergrund)
  cardName?: string;
  setName?: string;
  setCode?: string;
  releasedAt?: string;
  colors?: string[];
  date: string; // wann gefunden/veroeffentlicht
  drafted?: boolean;
  /** Spoiler-Paket: die neuen Karten */
  cards?: SpoilerCard[];
}

interface Store {
  items: NewsItem[];
  seenCards: string[];
  banned: string[] | null; // null = noch kein Abgleich (erster Lauf = Basis)
  gameChangers: string[] | null;
  seenLinks: string[];
  lastPoll?: string;
  /** Neue Karten, die noch auf ein Spoiler-Paket warten (pro Set) */
  pending?: Record<string, { name: string; releasedAt?: string; since: string; cards: SpoilerCard[] }>;
}

const UA = "mtg-insta-tool/0.1 (+https://github.com/)";
const file = () => path.join(config.dataDir, "news.json");
let store: Store | null = null;

function load(): Store {
  if (store) return store;
  try {
    store = JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch {
    store = { items: [], seenCards: [], banned: null, gameChangers: null, seenLinks: [] };
  }
  return store!;
}
function save(): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  // nicht unendlich wachsen lassen
  const s = load();
  s.items = s.items.slice(0, 400);
  s.seenLinks = s.seenLinks.slice(-2000);
  fs.writeFileSync(file(), JSON.stringify(s));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function scryfall<T = any>(url: string): Promise<T> {
  await sleep(120); // Scryfall bittet um max. ~10 Anfragen pro Sekunde
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  const body: any = await res.json().catch(() => ({}));
  if (res.status === 404 && body?.object === "error") return { data: [], has_more: false } as T; // keine Treffer
  if (!res.ok) throw new Error(`Scryfall ${res.status}: ${body?.details ?? ""}`);
  return body as T;
}

async function searchAll(q: string): Promise<any[]> {
  let url: string | null = `https://api.scryfall.com/cards/search?unique=cards&order=released&q=${encodeURIComponent(q)}`;
  const out: any[] = [];
  while (url && out.length < 1500) {
    const page: any = await scryfall(url);
    out.push(...(page.data ?? []));
    url = page.has_more ? page.next_page : null;
  }
  return out;
}

function cardImages(c: any): { image?: string; art?: string } {
  const face = c.image_uris ?? c.card_faces?.[0]?.image_uris;
  return { image: face?.normal, art: face?.art_crop };
}

function oracle(c: any): string {
  return (c.oracle_text ?? c.card_faces?.map((f: any) => f.oracle_text).join("\n") ?? "").replace(/\([^)]*\)/g, "").trim();
}

function add(item: Omit<NewsItem, "id">): NewsItem {
  const full = { id: nanoid(10), ...item };
  load().items.unshift(full);
  return full;
}

/**
 * Neue Karten aus kommenden/gerade erschienenen Sets (und Secret Lair Drops der
 * letzten 30 Tage). Neue Karten sammeln sich pro Set; ab `spoilerMin` Karten
 * (oder nach 24 h) entsteht daraus ein Spoiler-Paket = ein Carousel-Entwurf.
 * Neue Commander erscheinen zusaetzlich einzeln im News-Feed.
 */
async function pollSpoilers(): Promise<NewsItem[]> {
  const s = load();
  s.pending ??= {};
  const today = new Date().toISOString().slice(0, 10);
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const sets: any[] = (await scryfall<any>("https://api.scryfall.com/sets")).data ?? [];
  const relevant = sets.filter(
    (x) => x.released_at >= since7 && ["expansion", "commander", "core", "draft_innovation", "masters", "funny"].includes(x.set_type)
  );
  const firstRun = s.seenCards.length === 0;
  const feed: NewsItem[] = [];

  const sources: { code: string; name: string; releasedAt?: string; query: string }[] = [
    ...relevant.map((x) => ({ code: x.code, name: x.name, releasedAt: x.released_at, query: `set:${x.code}` })),
    { code: "sld", name: "Secret Lair", query: `set:sld date>=${since30}` },
  ];

  for (const src of sources) {
    for (const c of await searchAll(src.query)) {
      if (s.seenCards.includes(c.id)) continue;
      s.seenCards.push(c.id);
      if (firstRun) continue; // erster Lauf: nur Basis merken, keine Flut
      const imgs = cardImages(c);
      const p = (s.pending[src.code] ??= { name: src.name, releasedAt: src.releasedAt ?? c.released_at, since: new Date().toISOString(), cards: [] });
      p.cards.push({ name: c.name, image: imgs.image, art: imgs.art, colors: c.color_identity });
      if (/Legendary/.test(c.type_line ?? "") && /Creature/.test(c.type_line ?? "")) {
        feed.push(
          add({
            type: "commander",
            title: `New commander: ${c.name}`,
            body: oracle(c),
            url: c.scryfall_uri,
            ...imgs,
            cardName: c.name,
            setName: src.name,
            setCode: src.code,
            releasedAt: src.releasedAt ?? c.released_at,
            colors: c.color_identity,
            date: new Date().toISOString(),
          })
        );
      }
    }
  }

  // Spoiler-Pakete schnueren
  const min = getSettings().spoilerMin;
  const spoilers: NewsItem[] = [];
  for (const [code, p] of Object.entries(s.pending)) {
    const old = Date.now() - new Date(p.since).getTime() > 24 * 3600_000;
    if (p.cards.length < min && !old) continue;
    delete s.pending[code];
    if (!p.cards.length) continue;
    const upcoming = p.releasedAt && p.releasedAt > today;
    spoilers.push(
      add({
        type: "spoiler",
        title: `${p.cards.length} new card${p.cards.length === 1 ? "" : "s"} from ${p.name}`,
        cards: p.cards.slice(0, 36),
        art: p.cards[0].art,
        image: p.cards[0].image,
        setName: p.name,
        setCode: code,
        releasedAt: p.releasedAt,
        colors: p.cards[0].colors,
        url: `https://scryfall.com/sets/${code}`,
        body: upcoming ? `Out ${p.releasedAt}` : undefined,
        date: new Date().toISOString(),
      })
    );
  }
  return [...spoilers, ...feed];
}

/** Bann-/Game-Changer-Liste abgleichen (erster Lauf = nur Basis speichern) */
async function pollList(query: string, key: "banned" | "gameChangers", addType: NewsType, removeType: NewsType | null): Promise<NewsItem[]> {
  const s = load();
  const cards = await searchAll(query);
  const ids = cards.map((c) => c.oracle_id ?? c.id);
  const prev = s[key];
  s[key] = ids;
  if (!prev) return [];
  const found: NewsItem[] = [];
  for (const c of cards.filter((c) => !prev.includes(c.oracle_id ?? c.id))) {
    found.push(
      add({
        type: addType,
        title: addType === "ban" ? `Banned in Commander: ${c.name}` : `New Game Changer: ${c.name}`,
        body: oracle(c),
        url: c.scryfall_uri,
        ...cardImages(c),
        cardName: c.name,
        colors: c.color_identity,
        date: new Date().toISOString(),
      })
    );
  }
  if (removeType) {
    for (const id of prev.filter((p) => !ids.includes(p))) {
      // Karte nachschlagen, damit Name/Bild stimmen
      const c: any = await scryfall(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(`oracleid:${id}`)}`).then((r: any) => r.data?.[0]);
      if (!c) continue;
      found.push(
        add({
          type: removeType,
          title: removeType === "unban" ? `Unbanned in Commander: ${c.name}` : `No longer a Game Changer: ${c.name}`,
          body: oracle(c),
          url: c.scryfall_uri,
          ...cardImages(c),
          cardName: c.name,
          colors: c.color_identity,
          date: new Date().toISOString(),
        })
      );
    }
  }
  return found;
}

/** RSS/Atom-Feeds aus den Einstellungen (Titel + Link) */
async function pollFeeds(): Promise<NewsItem[]> {
  const s = load();
  const found: NewsItem[] = [];
  for (const feed of getSettings().newsFeeds) {
    try {
      const res = await fetch(feed, { headers: { "User-Agent": UA } });
      const xml = await res.text();
      const entries = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/g)].map((m) => m[0]).slice(0, 15);
      const firstRunForFeed = !s.seenLinks.some((l) => l.startsWith(feed + "|"));
      for (const e of entries) {
        const title = decode(e.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? "");
        const link = e.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? decode(e.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "");
        const date = e.match(/<(pubDate|updated|published)>([\s\S]*?)<\/\1>/)?.[2];
        if (!title || !link) continue;
        const k = `${feed}|${link}`;
        if (s.seenLinks.includes(k)) continue;
        s.seenLinks.push(k);
        const item = add({ type: "article", title, url: link, setName: new URL(feed).hostname, date: date ? new Date(date).toISOString() : new Date().toISOString() });
        if (!firstRunForFeed) found.push(item);
      }
    } catch (err) {
      console.error("[news] feed failed:", feed, err instanceof Error ? err.message : err);
    }
  }
  return found;
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .trim();
}

let polling: Promise<number> | null = null;

// Wird vom Server gesetzt (vermeidet zirkulaere Imports Render <-> News)
let autoDrafter: ((item: NewsItem) => Promise<unknown>) | null = null;
export function setAutoDrafter(fn: (item: NewsItem) => Promise<unknown>): void {
  autoDrafter = fn;
}

/** Alle Quellen abfragen; liefert die Anzahl neuer Meldungen */
export function pollNews(): Promise<number> {
  if (polling) return polling;
  polling = (async () => {
    const fresh: NewsItem[] = [];
    for (const step of [
      () => pollSpoilers(),
      () => pollList("banned:commander", "banned", "ban", "unban"),
      () => pollList("is:gamechanger", "gameChangers", "gamechanger", "gamechanger_removed"),
      () => pollFeeds(),
    ]) {
      try {
        fresh.push(...(await step()));
      } catch (err) {
        console.error("[news]", err instanceof Error ? err.message : err);
      }
    }
    load().lastPoll = new Date().toISOString();
    load().items.sort((a, b) => b.date.localeCompare(a.date));
    save();
    // Zusaetzliche Entwuerfe (ersetzen keine Tagesposts): Spoiler-Pakete und Listen-Aenderungen
    if (getSettings().newsAutoDraft && autoDrafter) {
      for (const it of fresh.filter((f) => ["spoiler", "ban", "unban", "gamechanger", "gamechanger_removed"].includes(f.type))) {
        await autoDrafter(it).catch((err) => console.error("[news] auto draft failed:", err instanceof Error ? err.message : err));
      }
    }
    if (fresh.length && getSettings().newsPush) {
      const important = fresh.filter((f) => f.type !== "article");
      await notify({
        title: important.length ? `${important.length} MTG-News` : `${fresh.length} neue Artikel`,
        body: (important.length ? important : fresh).slice(0, 3).map((f) => f.title).join(" · "),
        url: "/news.html",
        tag: "news",
      }).catch(() => undefined);
    }
    return fresh.length;
  })().finally(() => (polling = null));
  return polling;
}

export function listNews(): { items: NewsItem[]; lastPoll?: string } {
  const s = load();
  return { items: s.items, lastPoll: s.lastPoll };
}

export function getNews(id: string): NewsItem | undefined {
  return load().items.find((i) => i.id === id);
}

export function markDrafted(id: string): void {
  const it = getNews(id);
  if (it) {
    it.drafted = true;
    save();
  }
}

/**
 * Eigene News: Kartennamen (eine pro Zeile) oder eine Scryfall-Suche.
 * Mehrere Karten -> Spoiler-Paket, eine Karte -> Einzelmeldung.
 */
export async function customNews(input: string, title: string): Promise<NewsItem> {
  const lines = input.split("\n").map((l) => l.trim()).filter(Boolean);
  const isQuery = lines.length === 1 && /[:<>=]/.test(lines[0]);
  const cards: any[] = [];
  if (isQuery) {
    cards.push(...(await searchAll(lines[0])).slice(0, 36));
  } else {
    for (const name of lines.slice(0, 36)) {
      const c: any = await scryfall(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`).catch(() => null);
      if (c?.name) cards.push(c);
    }
  }
  if (!cards.length) throw new Error("Keine Karten auf Scryfall gefunden");
  const first = cards[0];
  const imgs = cardImages(first);
  const sameSet = cards.every((c) => c.set === first.set);
  const base = {
    url: cards.length === 1 ? first.scryfall_uri : sameSet ? `https://scryfall.com/sets/${first.set}` : undefined,
    ...imgs,
    setName: sameSet ? first.set_name : undefined,
    setCode: sameSet ? first.set : undefined,
    releasedAt: sameSet ? first.released_at : undefined,
    colors: first.color_identity,
    date: new Date().toISOString(),
  };
  const item: NewsItem =
    cards.length === 1
      ? add({
          type: /Legendary/.test(first.type_line ?? "") && /Creature/.test(first.type_line ?? "") ? "commander" : "article",
          title: title || `${first.name}`,
          body: oracle(first),
          cardName: first.name,
          ...base,
        })
      : add({
          type: "spoiler",
          title: title || `${cards.length} new cards${sameSet ? ` from ${first.set_name}` : ""}`,
          cards: cards.map((c) => ({ name: c.name, ...cardImages(c), colors: c.color_identity })),
          ...base,
        });
  save();
  return item;
}
