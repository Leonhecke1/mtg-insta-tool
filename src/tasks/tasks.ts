import { nanoid } from "nanoid";
import { notify } from "../push/push";

/**
 * Hintergrund-Auftraege (Deck holen, Reel rendern ...). Eine Anfrage startet
 * nur den Auftrag und kehrt sofort zurueck; die App fragt den Fortschritt ab.
 * So bricht nichts ab, wenn man die Seite wechselt oder Safari die App
 * pausiert ("Load failed" bei langen Anfragen).
 */

export type Report = (step: string, progress?: number) => void;

export interface Task {
  id: string;
  label: string;
  status: "running" | "done" | "failed";
  step: string;
  /** 0..1, null = unbestimmt */
  progress: number | null;
  startedAt: string;
  finishedAt?: string;
  result?: unknown;
  /** Kurze Ergebniszeile fuer die App ("3 neue Meldungen, 1 Entwurf") */
  summary?: string;
  error?: string;
}

const tasks = new Map<string, Task>();
const KEEP_FINISHED_MS = 30 * 60_000;

function prune(): void {
  const now = Date.now();
  for (const [id, t] of tasks) {
    if (t.finishedAt && now - new Date(t.finishedAt).getTime() > KEEP_FINISHED_MS) tasks.delete(id);
  }
}

export function startTask<T>(
  label: string,
  fn: (report: Report) => Promise<T>,
  opts: { notifyOnDone?: (result: T) => string; summary?: (result: T) => string } = {}
): Task {
  prune();
  const task: Task = {
    id: nanoid(10),
    label,
    status: "running",
    step: "Startet …",
    progress: 0,
    startedAt: new Date().toISOString(),
  };
  tasks.set(task.id, task);

  const report: Report = (step, progress) => {
    task.step = step;
    if (progress !== undefined) task.progress = Math.max(0, Math.min(1, progress));
  };

  fn(report)
    .then((result) => {
      task.status = "done";
      task.step = "Fertig";
      task.progress = 1;
      task.result = result;
      if (opts.summary) task.summary = opts.summary(result);
      task.finishedAt = new Date().toISOString();
      if (opts.notifyOnDone) {
        notify({ title: `${label}: fertig`, body: opts.notifyOnDone(result), tag: `task-${task.id}` }).catch(() => undefined);
      }
    })
    .catch((err) => {
      task.status = "failed";
      task.error = err instanceof Error ? err.message : String(err);
      task.step = "Fehlgeschlagen";
      task.finishedAt = new Date().toISOString();
      console.error(`[task] ${label} failed:`, task.error);
      notify({ title: `${label}: fehlgeschlagen`, body: task.error.slice(0, 140), tag: `task-${task.id}` }).catch(() => undefined);
    });

  return task;
}

export function getTask(id: string): Task | undefined {
  return tasks.get(id);
}

export function listTasks(): Task[] {
  prune();
  return [...tasks.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Teilfortschritt auf einen Bereich [from, to] des Gesamtbalkens abbilden */
export function subReport(report: Report, from: number, to: number): Report {
  return (step, p) => report(step, p === undefined ? undefined : from + (to - from) * p);
}
