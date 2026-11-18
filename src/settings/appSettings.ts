import * as fs from "fs";
import * as path from "path";
import { config } from "../config";

/**
 * Einstellungen, die in der App (Einstellungen -> Automatik) geaendert werden.
 * Gespeichert in DATA_DIR/app-settings.json und sofort wirksam. Die Werte aus
 * der .env sind nur noch die Startwerte, bis zum ersten Speichern in der App.
 */

/** combo = Combo-Reel (Commander Spellbook) statt Deck */
export type DayKind = "reel" | "carousel" | "combo" | "none";

export interface DaySlot {
  kind: DayKind;
  /** "HH:MM" */
  time: string;
}

export interface AppSettings {
  /** Automatisch Entwuerfe anlegen */
  dailyDecks: boolean;
  /** Index 0 = Sonntag ... 6 = Samstag (wie Date.getDay()) */
  schedule: DaySlot[];
  /** So viele Tage im Voraus Entwuerfe anlegen */
  lookaheadDays: number;
  /** Story-Grafik nach jedem Post */
  story: boolean;
  /** Minuten nach dem Post */
  storyDelayMin: number;
  budgetMaxEur: number;
  archidektOwnUsername: string;
  autoReply: boolean;
  autoReplyDelayMin: number;
  autoHideSpam: boolean;
  /** "short" ~15 s (Hook, Commander, Schluesselkarten, Preis, CTA), "full" ~24 s mit allen Szenen */
  reelLength: "short" | "full";
  /** MTG-News (Scryfall: neue Commander, Bann-/Game-Changer-Aenderungen) */
  newsEnabled: boolean;
  newsPush: boolean;
  /** Zusaetzliche RSS/Atom-Feeds */
  newsFeeds: string[];
  /** Alle wie viele Stunden nach News schauen */
  newsIntervalHours: number;
  /** Aus Spoilern und Listen-Aenderungen automatisch Entwuerfe anlegen */
  newsAutoDraft: boolean;
  /** Ab so vielen neuen Karten eines Sets entsteht ein Spoiler-Carousel */
  spoilerMin: number;
}

function envDefaults(): AppSettings {
  const time = `${String(config.dailyPostHour).padStart(2, "0")}:00`;
  // Reel-Fokus (Reels erreichen Nicht-Follower, siehe /ig-plan): Mo-Sa Reel, So Carousel.
  // Wurde DAILY_REEL_DAYS gesetzt, gilt das bis zum ersten Speichern in der App.
  const reelDays = config.dailyReelDays.length ? config.dailyReelDays : [1, 2, 3, 4, 5, 6];
  return {
    dailyDecks: config.dailyDecks,
    schedule: Array.from({ length: 7 }, (_, d) => ({ kind: reelDays.includes(d) ? "reel" : "carousel", time })),
    lookaheadDays: config.dailyLookaheadDays,
    // Aus: den neuen Beitrag selbst per Repost in die Story teilen ist klickbar
    story: false,
    storyDelayMin: 60,
    budgetMaxEur: config.dailyBudgetMaxEur,
    archidektOwnUsername: config.archidektOwnUsername,
    autoReply: config.autoReply,
    autoReplyDelayMin: config.autoReplyDelayMin,
    autoHideSpam: config.autoHideSpam,
    reelLength: "full",
    newsEnabled: true,
    newsPush: true,
    newsFeeds: [],
    newsIntervalHours: 6,
    newsAutoDraft: true,
    spoilerMin: 3,
  };
}

const file = () => path.join(config.dataDir, "app-settings.json");
let cache: AppSettings | null = null;

export function getSettings(): AppSettings {
  if (cache) return cache;
  let saved: Partial<AppSettings> = {};
  try {
    saved = JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch {
    /* noch nichts gespeichert */
  }
  cache = sanitize({ ...envDefaults(), ...saved });
  return cache;
}

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function sanitize(s: Partial<AppSettings>): AppSettings {
  const d = envDefaults();
  const schedule = Array.from({ length: 7 }, (_, i) => {
    const slot = Array.isArray(s.schedule) ? s.schedule[i] : undefined;
    const kind: DayKind = slot && ["reel", "carousel", "combo", "none"].includes(slot.kind) ? slot.kind : d.schedule[i].kind;
    const time = slot && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(slot.time)) ? String(slot.time) : d.schedule[i].time;
    return { kind, time };
  });
  return {
    dailyDecks: typeof s.dailyDecks === "boolean" ? s.dailyDecks : d.dailyDecks,
    schedule,
    lookaheadDays: clampInt(s.lookaheadDays, 1, 14, d.lookaheadDays),
    story: typeof s.story === "boolean" ? s.story : d.story,
    storyDelayMin: clampInt(s.storyDelayMin, 0, 720, d.storyDelayMin),
    budgetMaxEur: clampInt(s.budgetMaxEur, 20, 5000, d.budgetMaxEur),
    archidektOwnUsername: typeof s.archidektOwnUsername === "string" ? s.archidektOwnUsername.trim().slice(0, 60) : d.archidektOwnUsername,
    autoReply: typeof s.autoReply === "boolean" ? s.autoReply : d.autoReply,
    autoReplyDelayMin: clampInt(s.autoReplyDelayMin, 1, 240, d.autoReplyDelayMin),
    autoHideSpam: typeof s.autoHideSpam === "boolean" ? s.autoHideSpam : d.autoHideSpam,
    reelLength: s.reelLength === "full" || s.reelLength === "short" ? s.reelLength : d.reelLength,
    newsEnabled: typeof s.newsEnabled === "boolean" ? s.newsEnabled : d.newsEnabled,
    newsPush: typeof s.newsPush === "boolean" ? s.newsPush : d.newsPush,
    newsFeeds: Array.isArray(s.newsFeeds)
      ? s.newsFeeds.map((u) => String(u).trim()).filter((u) => /^https?:\/\/\S+$/.test(u)).slice(0, 20)
      : d.newsFeeds,
    newsIntervalHours: clampInt(s.newsIntervalHours, 1, 48, d.newsIntervalHours),
    newsAutoDraft: typeof s.newsAutoDraft === "boolean" ? s.newsAutoDraft : d.newsAutoDraft,
    spoilerMin: clampInt(s.spoilerMin, 1, 30, d.spoilerMin),
  };
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = sanitize({ ...getSettings(), ...patch });
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(next, null, 2));
  cache = next;
  return next;
}

/** Posttermin fuer ein Datum laut Wochenplan; null = an diesem Tag nichts */
export function slotFor(date: Date): { when: Date; kind: Exclude<DayKind, "none"> } | null {
  const slot = getSettings().schedule[date.getDay()];
  if (slot.kind === "none") return null;
  const [h, m] = slot.time.split(":").map(Number);
  const when = new Date(date);
  when.setHours(h, m, 0, 0);
  return { when, kind: slot.kind };
}
