import * as fs from "fs";
import * as path from "path";
import low, { LowdbSync } from "lowdb";
import FileSync from "lowdb/adapters/FileSync";
import { nanoid } from "nanoid";
import { config, instagramConfigured } from "../config";
import { fetchOwnCaptions } from "../instagram/client";
import { fetchArchidektDeck } from "../parser/archidekt";
import { runPipeline } from "../pipeline";
import { createJob, listJobs, updateJob } from "../jobs/jobStore";
import { ensureJpegs } from "../render/renderer";
import { buildNewPostStory, buildReel, reelCoverPath } from "../render/reel";
import { notify } from "../push/push";
import { addItem, listItems } from "../queue/queueStore";
import { Report, subReport } from "../tasks/tasks";
import { creditFromText, igCaption } from "../skills/igCaption";
import { getSettings, slotFor } from "../settings/appSettings";

const noop: Report = () => undefined;

/** Video + Titelbild (falls vorhanden) */
async function reelMedia(deck: Parameters<typeof buildReel>[0], dir: string, report: Report = noop): Promise<string[]> {
  const video = await buildReel(deck, dir, { onProgress: report });
  const cover = reelCoverPath(video);
  return fs.existsSync(cover) ? [video, cover] : [video];
}
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

/**
 * Was schon auf Instagram ist - die verlaessliche Quelle, auch wenn der
 * Server out/ und data/ der alten Posts nicht kennt (z. B. frisch geklont).
 * Archidekt-Links und Commander-Namen werden aus den Captions gelesen.
 * 1 Stunde gecacht.
 */
let igHistory: { at: number; deckIds: Set<number>; text: string } | null = null;

async function instagramHistory(): Promise<{ deckIds: Set<number>; text: string }> {
  if (!instagramConfigured()) return { deckIds: new Set(), text: "" };
  if (igHistory && Date.now() - igHistory.at < 3600_000) return igHistory;
  try {
    const captions = await fetchOwnCaptions();
    const deckIds = new Set<number>();
    for (const c of captions) {
      for (const m of c.matchAll(/archidekt\.com\/decks\/(\d+)/g)) deckIds.add(Number(m[1]));
    }
    igHistory = { at: Date.now(), deckIds, text: norm(captions.join(" ")) };
    console.log(`[daily] instagram history: ${captions.length} posts, ${deckIds.size} archidekt links`);
    return igHistory;
  } catch (err) {
    console.error("[daily] instagram history failed:", err instanceof Error ? err.message : err);
    return igHistory ?? { deckIds: new Set(), text: "" };
  }
}

/** Nach einem neuen Post den Cache verwerfen */
export function invalidateInstagramHistory(): void {
  igHistory = null;
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
  if (getSettings().archidektOwnUsername) {
    const own = await searchDecks({ ownerUsername: getSettings().archidektOwnUsername, orderBy: "-createdAt" });
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
export async function produceDeckTech(report: Report = noop): Promise<{ job: Job; own: boolean } | null> {
  report("Lese bisherige Posts", 0.02);
  const used = usedSets();
  const ig = await instagramHistory();
  ig.deckIds.forEach((id) => used.deckIds.add(id));
  // Commander gilt als gepostet, wenn sein voller Name in einer Caption steht
  const postedOnIg = (name: string) => ig.text.length > 0 && norm(name).length >= 6 && ig.text.includes(norm(name));
  let tries = 0;

  report("Suche Decks auf Archidekt", 0.05);
  for (const { deck, own } of await candidates()) {
    if (used.deckIds.has(deck.id)) continue;
    if (tries >= 6) break;

    const listingProblem = own ? null : acceptableListing(deck);
    if (listingProblem) continue;

    const url = `https://archidekt.com/decks/${deck.id}`;
    tries++;

    // Commander vorab pruefen, bevor teuer gerendert wird
    report(`Prüfe „${deck.name}“ (Versuch ${tries})`, 0.05 + 0.03 * tries);
    const raw = await fetchArchidektDeck(url);
    const commander = raw.commanders.map((c) => c.name).join(" & ");
    if (!commander || raw.commanders.some((c) => used.commanders.has(norm(c.name)) || postedOnIg(c.name))) {
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
      report(`${commander}: lade Karten und rendere Slides`, 0.25);
      const result = await runPipeline(
        { kind: "archidekt", archidektUrl: url },
        {
          jobId,
          useLlm: Boolean(config.anthropicApiKey),
          creditLine: own ? undefined : `Deck by ${deck.owner.username} on Archidekt - all credit for the build goes to them.`,
        }
      );

      if (!own && result.deck.totalPriceEur > getSettings().budgetMaxEur) {
        report(`${commander} zu teuer (${Math.round(result.deck.totalPriceEur)} €), nächstes Deck`, 0.1);
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

/** Termin + Format fuer "heute + offset Tage" laut Wochenplan (null = Tag ist frei) */
function slotForOffset(offset: number): { when: Date; kind: "reel" | "carousel" } | null {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return slotFor(d);
}

function isDayTaken(when: Date): boolean {
  return listItems().some(
    (i) =>
      (i.kind === "carousel" || i.kind === "reel") &&
      i.origin !== "news" && // News sind zusaetzlich
      i.status !== "rejected" &&
      localDayKey(new Date(i.scheduledAt)) === localDayKey(when)
  );
}

/** Erzeugt Carousel- (+ Story-)Entwurf fuer einen Tag. null = kein passendes Deck. */
async function draftForDay(when: Date, kind: "reel" | "carousel", report: Report = noop): Promise<string | null> {
  const reelDay = kind === "reel";
  // Fortschritt: Deck finden/rendern 0-55 %, Reel 55-92 %, Story danach
  const produced = await produceDeckTech(subReport(report, 0, reelDay ? 0.55 : 0.85));
  if (!produced) {
    console.warn(`[daily] no suitable deck found for ${localDayKey(when)}`);
    return null;
  }
  const { job } = produced;
  const r = job.result!;
  report("Bereite Bilder für Instagram vor", reelDay ? 0.55 : 0.86);
  const jpgs = await ensureJpegs(r.slideFiles.slice(0, 10));
  const label = r.deckSummary?.commander ?? job.id;

  const media = reelDay ? await reelMedia(r.deck, r.jobDir, subReport(report, 0.56, 0.92)) : jpgs;
  // Caption nach /ig-caption (+ /ig-human), Decklisten-Link als erster Kommentar
  const ig = igCaption(r.deck, {
    kind: reelDay ? "reel" : "carousel",
    archidektUrl: job.input.archidektUrl,
    creditUser: produced.own ? undefined : creditFromText(r.texts.caption.body),
  });
  addItem({
    id: nanoid(10),
    kind: reelDay ? "reel" : "carousel",
    status: "draft",
    createdAt: new Date().toISOString(),
    scheduledAt: when.toISOString(),
    mediaToken: nanoid(24),
    mediaFiles: media,
    caption: ig.caption,
    firstComment: ig.firstComment ?? undefined,
    keywords: ig.keywords,
    sourceJobId: job.id,
    label,
  });

  if (getSettings().story) {
    report("Erzeuge Story-Grafik", 0.95);
    addItem({
      id: nanoid(10),
      kind: "story",
      status: "draft",
      createdAt: new Date().toISOString(),
      scheduledAt: new Date(when.getTime() + getSettings().storyDelayMin * 60_000).toISOString(),
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
    const created: string[] = [];
    try {
      for (let offset = 1; offset <= getSettings().lookaheadDays; offset++) {
        const slot = slotForOffset(offset);
        if (!slot || isDayTaken(slot.when)) continue;
        const label = await draftForDay(slot.when, slot.kind);
        if (!label) break;
        created.push(label);
      }
    } finally {
      if (created.length) {
        await notify({
          title: created.length === 1 ? "Neues Deck wartet auf Freigabe" : `${created.length} neue Decks warten auf Freigabe`,
          body: created.join(", "),
          tag: "new-decks",
        }).catch((err) => console.error("[push]", err));
      }
    }
  });
}

/** Button "Neues Deck holen": Entwurf fuer den naechsten freien Tag. */
export function fetchNextDeck(
  day?: string,
  report: Report = noop
): Promise<{ label: string; scheduledAt: string }> {
  report("Wartet auf laufenden Auftrag", 0);
  return serialized(async () => {
    // Bestimmter Tag aus der Plan-Ansicht ("YYYY-MM-DD")
    if (day) {
      const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) throw new Error("Ungültiges Datum");
      // An einem "freien" Tag des Wochenplans trotzdem erlaubt: dann Reel um 19:00
      const date = new Date(+m[1], +m[2] - 1, +m[3]);
      const slot = slotFor(date) ?? { when: new Date(+m[1], +m[2] - 1, +m[3], 19, 0, 0, 0), kind: "reel" as const };
      if (slot.when.getTime() < Date.now()) throw new Error("Der Termin liegt in der Vergangenheit");
      if (isDayTaken(slot.when)) throw new Error("An diesem Tag ist schon ein Post geplant");
      const label = await draftForDay(slot.when, slot.kind, report);
      if (!label) throw new Error("Kein passendes Deck gefunden, später nochmal versuchen");
      return { label, scheduledAt: slot.when.toISOString() };
    }
    for (let offset = 1; offset <= 60; offset++) {
      const slot = slotForOffset(offset);
      if (!slot || isDayTaken(slot.when)) continue;
      const label = await draftForDay(slot.when, slot.kind, report);
      if (!label) throw new Error("Kein passendes Deck gefunden, später nochmal versuchen");
      return { label, scheduledAt: slot.when.toISOString() };
    }
    throw new Error("Die nächsten 60 Tage sind schon verplant");
  });
}

/** Einstellungen des Automatismus fuer die Plan-Ansicht */
export function planInfo() {
  return getSettings();
}
