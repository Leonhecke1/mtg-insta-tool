import { instagramConfigured } from "../config";
import { fetchRecentMediaStats } from "../instagram/client";
import { listItems } from "../queue/queueStore";
import { AppSettings, DaySlot, getSettings } from "../settings/appSettings";

/**
 * Plan-Check nach /ig-plan (instagram-agent-skill, MIT):
 *  - Reels sind das einzige Format, das zuverlaessig Nicht-Follower erreicht;
 *    Carousels gehen in die Tiefe bei bestehenden Followern.
 *  - mindestens 3 Reels pro Woche, 4-5 Posts gelten als Minimum
 *  - Stories taeglich
 *  - Postzeit: frueher Abend fuer ein Consumer-Publikum. Aber: die Uhrzeit ist
 *    viel weniger wichtig als die ersten zwei Sekunden.
 * Dazu die eigenen Zahlen: welches Format laeuft bei diesem Account besser.
 */

export interface PlanCheck {
  checks: { status: "PASS" | "WARN" | "FAIL" | "INFO"; title: string; detail: string }[];
  evidence: { type: string; posts: number; avgEngagement: number }[] | null;
  recommended: AppSettings;
  changes: string[];
  draftsToConvert: number;
}

const DAY = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

export async function checkPlan(): Promise<PlanCheck> {
  const s = getSettings();
  const checks: PlanCheck["checks"] = [];
  const posts = s.schedule.filter((d) => d.kind !== "none").length;
  const reels = s.schedule.filter((d) => d.kind === "reel").length;
  const carousels = s.schedule.filter((d) => d.kind === "carousel").length;

  // Eigene Zahlen (Likes + 3x Kommentare als Naeherung; Aufrufe braucht die Insights-Berechtigung)
  let evidence: PlanCheck["evidence"] = null;
  let reelsWin: boolean | null = null;
  if (instagramConfigured()) {
    try {
      const media = await fetchRecentMediaStats(30);
      const groups = new Map<string, number[]>();
      for (const m of media) {
        const t = m.media_product_type === "REELS" ? "Reel" : m.media_type === "CAROUSEL_ALBUM" ? "Carousel" : "Bild";
        groups.set(t, [...(groups.get(t) ?? []), (m.like_count ?? 0) + 3 * (m.comments_count ?? 0)]);
      }
      evidence = [...groups.entries()].map(([type, xs]) => ({
        type,
        posts: xs.length,
        avgEngagement: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10,
      }));
      const r = evidence.find((e) => e.type === "Reel");
      const c = evidence.find((e) => e.type === "Carousel");
      if (r && c) reelsWin = r.avgEngagement >= c.avgEngagement;
    } catch {
      /* ohne Zahlen weiter */
    }
  }

  checks.push(
    reels >= 3
      ? { status: "PASS", title: `${reels} Reels pro Woche`, detail: "Reels erreichen Leute, die dir noch nicht folgen. Mindestens 3 pro Woche." }
      : { status: "FAIL", title: `Nur ${reels} Reel(s) pro Woche`, detail: "Zum Wachsen mindestens 3 Reels pro Woche, Reels sind das Format für Reichweite." }
  );
  checks.push(
    posts >= 4
      ? { status: "PASS", title: `${posts} Posts pro Woche`, detail: "Genug Frequenz. Mehr hilft nur, solange die Qualität hält." }
      : { status: "WARN", title: `Nur ${posts} Posts pro Woche`, detail: "4–5 Posts pro Woche sind das Minimum, das /ig-plan empfiehlt." }
  );
  checks.push(
    carousels >= 1
      ? { status: "PASS", title: `${carousels} Carousel(s) pro Woche`, detail: "Carousels binden die Follower, die du schon hast (Speichern, Wischen)." }
      : { status: "INFO", title: "Kein Carousel", detail: "Ein Carousel pro Woche hält bestehende Follower bei der Stange." }
  );
  checks.push(
    s.story
      ? { status: "INFO", title: "Automatische Story-Grafik an", detail: "Nicht klickbar. Den Beitrag selbst in die Story teilen ist besser, dann führt er direkt zum Post." }
      : { status: "PASS", title: "Stories teilst du selbst", detail: "Den neuen Beitrag per Repost in die Story teilen: klickbar und führt direkt zum Post. Möglichst täglich eine Story, sonst wirkt das Profil verlassen." }
  );
  const lateOrEarly = s.schedule.filter((d) => {
    const h = +d.time.split(":")[0];
    return d.kind !== "none" && (h < 16 || h > 21);
  }).length;
  checks.push(
    lateOrEarly
      ? { status: "INFO", title: `${lateOrEarly} Termin(e) außerhalb 16–21 Uhr`, detail: "Früher Abend passt meist am besten. Wichtiger als die Uhrzeit sind aber die ersten zwei Sekunden des Reels." }
      : { status: "PASS", title: "Postzeiten am frühen Abend", detail: "Gut. Die Uhrzeit zählt weniger als der Hook in den ersten zwei Sekunden." }
  );
  checks.push({
    status: "INFO",
    title: s.reelLength === "short" ? "Kurze Reels (~15 s)" : "Ausführliche Reels (~24 s)",
    detail: "Entscheidend ist, dass die Leute dranbleiben: Der Hook öffnet eine Frage, die erst bei den Schlüsselkarten aufgelöst wird. Liegt die durchschnittliche Wiedergabe deutlich unter der Hälfte, lohnt sich „kurz“.",
  });
  if (reelsWin === true) {
    checks.push({ status: "INFO", title: "Deine Zahlen: Reels laufen besser", detail: "Deine Reels bekommen im Schnitt mehr Interaktionen als deine Carousels. Fokus auf Reels." });
  } else if (reelsWin === false) {
    checks.push({ status: "INFO", title: "Deine Zahlen: Carousels laufen besser", detail: "Deine Carousels bekommen mehr Interaktionen. Reels trotzdem behalten, sie bringen neue Leute." });
  }
  checks.push({
    status: "INFO",
    title: "Engagement-Runde (manuell)",
    detail: "Täglich 20 Minuten vor dem Posten: 5 größere Accounts früh kommentieren, 3 gleich große, 2 potenzielle Partner. Das kann und soll kein Bot machen.",
  });

  // Empfehlung: Reel-Fokus, 1 Carousel am Sonntag, Story an; eigene Uhrzeiten bleiben
  const carouselDay = reelsWin === false ? [0, 3] : [0];
  const schedule: DaySlot[] = s.schedule.map((d, i) => ({
    kind: carouselDay.includes(i) ? "carousel" : "reel",
    time: d.time,
  }));
  // Story bleibt, wie du sie eingestellt hast (Repost selbst ist klickbar)
  const recommended: AppSettings = { ...s, schedule, dailyDecks: true };
  const changes: string[] = [];
  schedule.forEach((d, i) => {
    if (d.kind !== s.schedule[i].kind) changes.push(`${DAY[i]}: ${label(s.schedule[i].kind)} → ${label(d.kind)}`);
  });
  if (!s.dailyDecks) changes.push("Automatische Entwürfe: an");

  return { checks, evidence, recommended, changes, draftsToConvert: carouselDraftsOnReelDays(schedule).length };
}

function label(k: string): string {
  return k === "reel" ? "Reel" : k === "carousel" ? "Carousel" : "frei";
}

/** Carousel-Entwuerfe, die laut (neuem) Plan an einem Reel-Tag liegen */
export function carouselDraftsOnReelDays(schedule = getSettings().schedule) {
  return listItems().filter(
    (i) =>
      i.kind === "carousel" &&
      i.status === "draft" &&
      i.sourceJobId &&
      new Date(i.scheduledAt).getTime() > Date.now() &&
      schedule[new Date(i.scheduledAt).getDay()].kind === "reel"
  );
}
