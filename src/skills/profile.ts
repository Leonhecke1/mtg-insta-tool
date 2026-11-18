import * as fs from "fs";
import * as path from "path";
import { config } from "../config";
import {
  commentReplyRate,
  fetchActiveStoryCount,
  fetchProfile,
  fetchRecentMediaStats,
  IgMediaStat,
  IgProfile,
} from "../instagram/client";
import { humanize } from "./human";
import rubricJson from "./lexicon/rubric.json";
import { getSettings } from "../settings/appSettings";

/**
 * Profil-Analyse nach /ig-profile (rubric.json aus dem "instagram-agent-skill"
 * von Jake Schincariol, MIT). 12 Punkte, 100 Punkte gesamt. Was die API liefert,
 * wird automatisch bewertet; den Rest (angepinnte Posts, Highlights, Grid,
 * Profilbild, Kategorie) beantwortest du einmal in der App.
 */

interface RubricItem {
  id: string;
  points: number;
  full_marks: string;
  common_fail: string;
}
const RUBRIC = (rubricJson as unknown as { items: RubricItem[] }).items;

const LABELS: Record<string, string> = {
  name_field: "Name-Feld",
  bio_first_line: "Bio, erste Zeile",
  bio_body: "Bio, Rest",
  pinned_three: "Angepinnte 3 Posts",
  link: "Link",
  highlights: "Highlights",
  grid_legibility: "Grid-Lesbarkeit",
  photo: "Profilbild",
  handle: "Handle",
  category_contact: "Kategorie & Kontakt",
  recent_activity: "Aktivität",
  story_presence: "Stories",
};

/** Antwortmoeglichkeiten fuer die Punkte, die die API nicht liefert */
export const MANUAL_OPTIONS: Record<string, { label: string; points: number }[]> = {
  pinned_three: [
    { label: "Nichts angepinnt", points: 0 },
    { label: "1–2 Posts angepinnt", points: 4 },
    { label: "3 angepinnt, aber eher zufällig", points: 6 },
    { label: "3 mit verschiedenen Aufgaben (bester Beweis, Erklärung, Vorstellung)", points: 10 },
  ],
  highlights: [
    { label: "Keine Highlights", points: 0 },
    { label: "Ungeordnet oder veraltet", points: 2 },
    { label: "Einige mit klaren Namen", points: 5 },
    { label: "4–6, klar benannt (z. B. Decks, Budget, About)", points: 8 },
  ],
  grid_legibility: [
    { label: "Cover ohne erkennbaren Text", points: 2 },
    { label: "Teilweise lesbar", points: 5 },
    { label: "Die ersten 9 Cover sind als Thumbnail klar lesbar", points: 8 },
  ],
  photo: [
    { label: "Unscharf, zu klein oder unpassend", points: 1 },
    { label: "Okay, aber im kleinen Kreis schwer erkennbar", points: 3 },
    { label: "Logo/Gesicht füllt den Kreis, klar erkennbar", points: 6 },
  ],
  category_contact: [
    { label: "Kategorie passt nicht, kein Kontakt-Button", points: 2 },
    { label: "Kategorie passt, aber kein Kontakt", points: 4 },
    { label: "Passende Kategorie und funktionierender Kontakt", points: 6 },
  ],
};

const answersFile = () => path.join(config.dataDir, "profile-answers.json");

export function getAnswers(): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(answersFile(), "utf8"));
  } catch {
    return {};
  }
}

export function saveAnswers(a: Record<string, unknown>): Record<string, number> {
  const clean: Record<string, number> = {};
  for (const [k, v] of Object.entries(a)) {
    if (MANUAL_OPTIONS[k] && typeof v === "number" && MANUAL_OPTIONS[k].some((o) => o.points === v)) clean[k] = v;
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(answersFile(), JSON.stringify(clean, null, 2));
  return clean;
}

const NICHE = /\b(commander|edh|deck|decks|mtg|magic)\b/i;

interface Score {
  id: string;
  label: string;
  max: number;
  points: number | null; // null = noch nicht beantwortet
  auto: boolean;
  detail: string;
  fullMarks: string;
}

function scoreAuto(p: IgProfile, media: IgMediaStat[], storyCount: number, replies: { total: number; answered: number } | null): Score[] {
  const out: Score[] = [];
  const item = (id: string) => RUBRIC.find((r) => r.id === id)!;
  const add = (id: string, points: number, detail: string) =>
    out.push({ id, label: LABELS[id], max: item(id).points, points: Math.min(points, item(id).points), auto: true, detail, fullMarks: item(id).full_marks });

  // Name-Feld: Name + gesuchte Begriffe
  const name = (p.name ?? "").trim();
  if (!name || name.toLowerCase() === p.username.toLowerCase()) add("name_field", 2, `„${name || "leer"}“: nur der Name, keine Suchbegriffe`);
  else if (NICHE.test(name)) add("name_field", 12, `„${name}“ enthält Suchbegriffe`);
  else add("name_field", 5, `„${name}“: keine Begriffe, nach denen jemand sucht (z. B. Commander, EDH)`);

  // Bio
  const bioLines = (p.biography ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const first = bioLines[0] ?? "";
  const pipes = (first.match(/[|•·]/g) ?? []).length;
  if (!first) add("bio_first_line", 0, "keine Bio");
  else if (!/[\p{L}\p{N}]/u.test(first))
    add("bio_first_line", 2, `„${first}“: die erste Zeile ist nur ein Emoji, dabei liest hier jeder zuerst`);
  else if (pipes >= 2 && first.split(/[|•·]/).every((s) => s.trim().split(/\s+/).length <= 3))
    add("bio_first_line", 4, `„${first}“: Stichwort-Liste statt „für wen und was es bringt“`);
  else if (NICHE.test(first) && /\b(you|your|for)\b/i.test(first)) add("bio_first_line", 12, `„${first}“: Zielgruppe und Nutzen`);
  else if (NICHE.test(first)) add("bio_first_line", 8, `„${first}“: Thema klar, aber nicht, was es dem Leser bringt`);
  else add("bio_first_line", 4, `„${first}“: Thema nicht sofort klar`);

  const rest = bioLines.slice(1).join(" ");
  if (!rest) add("bio_body", 1, "nur eine Zeile, kein Beweis und kein Angebot");
  else if (/\d|every day|daily|weekly|free|new deck/i.test(rest)) add("bio_body", 8, `„${rest}“: konkret`);
  else add("bio_body", 4, `„${rest}“: ohne Zahl oder konkretes Angebot`);

  // Link
  const site = p.website ?? "";
  if (!site) add("link", 0, "kein Link");
  else if (/linktr\.ee|beacons\.ai|linkin\.bio|lnk\.bio/i.test(site)) add("link", 5, `${site}: Link-Sammlung, ein direktes Ziel konvertiert besser`);
  else add("link", 8, `${site}: ein klares Ziel`);

  // Handle
  const h = p.username;
  if (/__|\d{2,}|[0-9](?=[a-z])/i.test(h)) add("handle", 3, `@${h}: schwer zu buchstabieren`);
  else add("handle", 6, `@${h}: gut lesbar`);

  // Aktivitaet
  const last = media[0] ? new Date(media[0].timestamp) : null;
  const days = last ? (Date.now() - last.getTime()) / 86400000 : Infinity;
  let act = days <= 7 ? 6 : days <= 14 ? 3 : 0;
  let actDetail = last ? `letzter Post vor ${Math.floor(days)} Tag(en)` : "noch keine Posts";
  if (replies) {
    const rate = replies.total ? replies.answered / replies.total : 1;
    act += rate >= 0.6 ? 4 : rate >= 0.3 ? 2 : 0;
    actDetail += replies.total ? `, ${replies.answered}/${replies.total} Kommentare unter dem letzten Post beantwortet` : ", keine Kommentare unter dem letzten Post";
  }
  add("recent_activity", act, actDetail);

  // Stories
  add("story_presence", storyCount > 0 ? 6 : 0, storyCount > 0 ? `${storyCount} Story/Stories gerade aktiv` : "gerade keine Story aktiv");

  return out;
}

export interface ProfileAnalysis {
  profile: IgProfile;
  total: number;
  answeredMax: number;
  complete: boolean;
  scores: Score[];
  manualOptions: typeof MANUAL_OPTIONS;
  suggestions: { nameField: string[]; bio: string; pinned: IgMediaStat[] };
  stats: {
    followers: number;
    posts30d: number;
    avgLikes: number;
    avgComments: number;
    byType: { type: string; posts: number; avgEngagement: number }[];
  };
}

export async function analyzeProfile(): Promise<ProfileAnalysis> {
  const [profile, media, storyCount] = await Promise.all([
    fetchProfile(),
    fetchRecentMediaStats(24),
    fetchActiveStoryCount().catch(() => 0),
  ]);
  const replies = media[0] ? await commentReplyRate(media[0].id, profile.username).catch(() => null) : null;

  const auto = scoreAuto(profile, media, storyCount, replies);
  const answers = getAnswers();
  const manual: Score[] = Object.keys(MANUAL_OPTIONS).map((id) => {
    const r = RUBRIC.find((x) => x.id === id)!;
    const pts = answers[id];
    const opt = MANUAL_OPTIONS[id].find((o) => o.points === pts);
    return {
      id,
      label: LABELS[id],
      max: r.points,
      points: pts ?? null,
      auto: false,
      detail: opt ? opt.label : "bitte einschätzen",
      fullMarks: r.full_marks,
    };
  });
  // Reihenfolge wie in rubric.json
  const scores = RUBRIC.map((r) => [...auto, ...manual].find((s) => s.id === r.id)!);
  const total = scores.reduce((n, s) => n + (s.points ?? 0), 0);
  const answeredMax = scores.reduce((n, s) => n + (s.points === null ? 0 : s.max), 0);

  // Statistik
  const eng = (m: IgMediaStat) => (m.like_count ?? 0) + 3 * (m.comments_count ?? 0);
  const recent30 = media.filter((m) => Date.now() - new Date(m.timestamp).getTime() < 30 * 86400000);
  const types = new Map<string, IgMediaStat[]>();
  for (const m of media) {
    const t = m.media_product_type === "REELS" ? "Reel" : m.media_type === "CAROUSEL_ALBUM" ? "Carousel" : "Bild";
    types.set(t, [...(types.get(t) ?? []), m]);
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  // Vorschlaege (fix-first: Name-Feld, Bio, angepinnte Posts)
  const budget = Math.round(getSettings().budgetMaxEur);
  const nameField = ["floating.mana | EDH Decks", "Budget Commander Decks", "EDH Deck Techs | Daily"].filter((n) => n.length <= 30);
  const bio = humanize(
    `Budget Commander decks you can actually build.\nA new deck tech every day, all under €${budget}.\nFull decklists below.`
  ).text;
  const pinned = [...media].sort((a, b) => eng(b) - eng(a)).slice(0, 3);

  return {
    profile,
    total,
    answeredMax,
    complete: scores.every((s) => s.points !== null),
    scores,
    manualOptions: MANUAL_OPTIONS,
    suggestions: { nameField, bio, pinned },
    stats: {
      followers: profile.followers_count ?? 0,
      posts30d: recent30.length,
      avgLikes: Math.round(avg(media.map((m) => m.like_count ?? 0)) * 10) / 10,
      avgComments: Math.round(avg(media.map((m) => m.comments_count ?? 0)) * 10) / 10,
      byType: [...types.entries()].map(([type, ms]) => ({ type, posts: ms.length, avgEngagement: Math.round(avg(ms.map(eng)) * 10) / 10 })),
    },
  };
}
