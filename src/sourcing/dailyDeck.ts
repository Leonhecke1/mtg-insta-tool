import * as fs from "fs";
import * as path from "path";
import low, { LowdbSync } from "lowdb";
import FileSync from "lowdb/adapters/FileSync";
import { nanoid } from "nanoid";
import { config } from "../config";
import { fetchArchidektDeck } from "../parser/archidekt";
import { runPipeline } from "../pipeline";
import { createJob, listJobs, updateJob } from "../jobs/jobStore";
import { ensureJpegs } from "../render/renderer";
import { buildNewPostStory } from "../render/reel";
import { addItem, listItems } from "../queue/queueStore";
import { Job } from "../types";

/**
 * Taeglicher Deck-Post: legt fuer die naechsten Tage je einen Carousel-
 * ENTWURF (+ optional Story) in der Freigabe-Queue an.
 *
 * Quelle: Archidekt (oeffentliche Decks, 1-2 API-Aufrufe pro Deck).
 *  1. eigene Decks von ARCHIDEKT_OWN_USERNAME, die noch nie gepostet wurden
 *  2. sonst beliebte Community-Decks (Bracket <= 3 oder ohne Angabe, kein
 *     cEDH, unter Budget) - IMMER mit Credit an den Ersteller in der Caption
 * Kein Commander wird doppelt verwendet (gegen alle bisherigen Jobs).
 * Moxfield wird bewusst nicht automatisch abgefragt (blockt Automatisierung).
 */

const UA = "mtg-insta-tool/0.1 (+https://github.com/)";

interface SourcedDeck {
  deckId: number;
  owner: string;
  commander?: string;
  at: string;
  outcome: "queued" | "skipped";
  reason?: string;
}

interface Schema {
  decks: SourcedDeck[];
}

let db: LowdbSync<Schema> | null = null;
function getDb(): LowdbSync<Schema> {
  if (db) return db;
  fs.mkdirSync(config.dataDir, { recursive: true });
  db = low(new FileSync<Schema>(path.join(config.dataDir, "sourcing.json")));
  db.defaults({ decks: [] }).write();
  return db;
}

interface ArchidektSearchDeck {
  id: number;
  name: string;
  size: number;
  edhBracket: number | null;
  private: boolean;
  unlisted: boolean;
  theorycrafted: boolean;
  tags?: { name: string }[];
  owner: { username: string };
}

async function searchDecks(params: Record<string, string>): Promise<ArchidektSearchDeck[]> {
  const qs = new URLSearchParams({ deckFormat: "3", pageSize: "50", ...params });
  const res = await fetch(`https://archidekt.com/api/decks/v3/?${qs}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Archidekt search HTTP ${res.status}`);
  const body: any = await res.json();
  return (body.results ?? []) as ArchidektSearchDeck[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Deck-IDs und Commander, die schon verwendet wurden (Jobs + Captions + Log). */
function usedSets(): { deckIds: Set<number>; commanders: Set<string> } {
  const deckIds = new Set<number>(getDb().get("decks").value().map((d) => d.deckId));
  const commanders = new Set<string>();

  for (const job of listJobs()) {
    const id = job.input.archidektUrl?.match(/decks\/(\d+)/)?.[1];
    if (id) deckIds.add(Number(id));
    for (const c of job.result?.deck.commanders ?? []) commanders.add(norm(c.name));
  }
  // Aeltere Posts, die nur als out/<id>/caption.txt existieren
  if (fs.existsSync(config.outDir)) {
    for (const dir of fs.readdirSync(config.outDir)) {
      const cap = path.join(config.outDir, dir, "caption.txt");
      if (!fs.existsSync(cap)) continue;
      const m = fs.readFileSync(cap, "utf8").match(/archidekt\.com\/decks\/(\d+)/);
      if (m) deckIds.add(Number(m[1]));
    }
  }
  for (const d of getDb().get("decks").value()) if (d.commander) commanders.add(norm(d.commander));
  return { deckIds, commanders };
}

function acceptableListing(d: ArchidektSearchDeck): string | null {
  if (d.private || d.unlisted) return "private";
  if (d.theorycrafted) return "theorycrafted";
  if (d.size !== 100) return `size ${d.size}`;
  if (d.edhBracket !== null && d.edhBracket > 3) return `bracket ${d.edhBracket}`;
  if ((d.tags ?? []).some((t) => /cedh|competitive|turbo/i.test(t.name))) return "cEDH tag";
  return null;
}

async function candidates(): Promise<{ deck: ArchidektSearchDeck; own: boolean }[]> {
  const out: { deck: ArchidektSearchDeck; own: boolean }[] = [];
  if (config.archidektOwnUsername) {
    const own = await searchDecks({ ownerUsername: config.archidektOwnUsername, orderBy: "-createdAt" });
    out.push(...own.map((deck) => ({ deck, own: true })));
  }
  // Zufaellige Seite der meistgesehenen Commander-Decks fuer Abwechslung
  const page = String(1 + Math.floor(Math.random() * 40));
  const community = await searchDecks({ orderBy: "-viewCount", page });
  community.sort(() => Math.random() - 0.5);
  out.push(...community.map((deck) => ({ deck, own: false })));
  return out;
}

function log(entry: SourcedDeck): void {
  getDb().get("decks").push(entry).write();
}

/** Waehlt ein passendes Deck, rendert es und gibt den fertigen Job zurueck. */
export async function produceDeckTech(): Promise<{ job: Job; own: boolean } | null> {
  const used = usedSets();
  let tries = 0;

  for (const { deck, own } of await candidates()) {
    if (used.deckIds.has(deck.id)) continue;
    if (tries >= 6) break;

    const listingProblem = own ? null : acceptableListing(deck);
    if (listingProblem) continue;

    const url = `https://archidekt.com/decks/${deck.id}`;
    tries++;

    // Commander vorab pruefen, bevor teuer gerendert wird
    const raw = await fetchArchidektDeck(url);
    const commander = raw.commanders.map((c) => c.name).join(" & ");
    if (!commander || raw.commanders.some((c) => used.commanders.has(norm(c.name)))) {
      log({ deckId: deck.id, owner: deck.owner.username, commander, at: new Date().toISOString(), outcome: "skipped", reason: "commander already covered" });
      continue;
    }

    const jobId = nanoid(10);
    const job: Job = {
      id: jobId,
      createdAt: new Date().toISOString(),
      status: "generating",
      input: { kind: "archidekt", archidektUrl: url },
    };
    createJob(job);

    try {
      const result = await runPipeline(
        { kind: "archidekt", archidektUrl: url },
        {
          jobId,
          useLlm: Boolean(config.anthropicApiKey),
          creditLine: own ? undefined : `Deck by ${deck.owner.username} on Archidekt - all credit for the build goes to them.`,
        }
      );

      if (!own && result.deck.totalPriceEur > config.dailyBudgetMaxEur) {
        updateJob(jobId, { status: "failed", error: "over budget (daily sourcing)" });
        log({ deckId: deck.id, owner: deck.owner.username, commander, at: new Date().toISOString(), outcome: "skipped", reason: `price ${Math.round(result.deck.totalPriceEur)} EUR` });
        continue;
      }

      const updated = updateJob(jobId, {
        status: "ready",
        result: {
          jobDir: result.jobDir,
          slideFiles: result.slideFiles,
          slideKinds: result.slideKinds,
          captionFile: result.captionFile,
          zipFile: result.zipFile,
          caption: result.caption,
          usedFallbackNames: result.usedFallbackNames,
          deck: result.deck,
          texts: result.texts,
          deckSummary: {
            commander: result.deck.commanders.map((c) => c.name).join(" & "),
            cardCount: result.deck.cardCount,
            totalPriceEur: result.deck.totalPriceEur,
            colorIdentity: result.deck.colorIdentity,
          },
        },
      })!;
      log({ deckId: deck.id, owner: deck.owner.username, commander, at: new Date().toISOString(), outcome: "queued" });
      return { job: updated, own };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateJob(jobId, { status: "failed", error: message });
      log({ deckId: deck.id, owner: deck.owner.username, commander, at: new Date().toISOString(), outcome: "skipped", reason: message.slice(0, 200) });
    }
  }
  return null;
}

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function postTimeForOffset(offset: number): Date {
  const when = new Date();
  when.setDate(when.getDate() + offset);
  when.setHours(config.dailyPostHour, 0, 0, 0);
  return when;
}

function isDayTaken(when: Date): boolean {
  return listItems().some(
    (i) =>
      (i.kind === "carousel" || i.kind === "reel") &&
      i.status !== "rejected" &&
      localDayKey(new Date(i.scheduledAt)) === localDayKey(when)
  );
}

/** Erzeugt Carousel- (+ Story-)Entwurf fuer einen Tag. null = kein passendes Deck. */
async function draftForDay(when: Date): Promise<string | null> {
  const produced = await produceDeckTech();
  if (!produced) {
    console.warn(`[daily] no suitable deck found for ${localDayKey(when)}`);
    return null;
  }
  const { job } = produced;
  const r = job.result!;
  const jpgs = await ensureJpegs(r.slideFiles.slice(0, 10));
  const label = r.deckSummary?.commander ?? job.id;

  addItem({
    id: nanoid(10),
    kind: "carousel",
    status: "draft",
    createdAt: new Date().toISOString(),
    scheduledAt: when.toISOString(),
    mediaToken: nanoid(24),
    mediaFiles: jpgs,
    caption: r.caption,
    sourceJobId: job.id,
    label,
  });

  if (config.dailyStory) {
    addItem({
      id: nanoid(10),
      kind: "story",
      status: "draft",
      createdAt: new Date().toISOString(),
      scheduledAt: new Date(when.getTime() + 60 * 60_000).toISOString(),
      mediaToken: nanoid(24),
      mediaFiles: [await buildNewPostStory(r.deck, r.slideFiles[0], r.jobDir)],
      sourceJobId: job.id,
      label: `${label} (Story)`,
    });
  }
  console.log(`[daily] drafted ${label} for ${when.toISOString()}`);
  return label;
}

// Serialisiert Scheduler-Lauf und Button-Klicks, damit nie zwei Decks
// gleichzeitig fuer denselben Tag gerendert werden.
let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

/**
 * Sorgt dafuer, dass fuer jeden der naechsten N Tage ein Deck-Post-Entwurf
 * existiert. Wird ein Entwurf abgelehnt, entsteht beim naechsten Lauf ein
 * neuer fuer diesen Tag ("ablehnen" = "gib mir ein anderes Deck").
 */
export function ensureDailyDrafts(): Promise<void> {
  return serialized(async () => {
    for (let offset = 1; offset <= config.dailyLookaheadDays; offset++) {
      const when = postTimeForOffset(offset);
      if (isDayTaken(when)) continue;
      if (!(await draftForDay(when))) return;
    }
  });
}

/** Button "Neues Deck holen": Entwurf fuer den naechsten freien Tag. */
export function fetchNextDeck(): Promise<{ label: string; scheduledAt: string }> {
  return serialized(async () => {
    for (let offset = 1; offset <= 60; offset++) {
      const when = postTimeForOffset(offset);
      if (isDayTaken(when)) continue;
      const label = await draftForDay(when);
      if (!label) throw new Error("Kein passendes Deck gefunden, später nochmal versuchen");
      return { label, scheduledAt: when.toISOString() };
    }
    throw new Error("Die nächsten 60 Tage sind schon verplant");
  });
}
