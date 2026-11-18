import * as fs from "fs";
import * as path from "path";
import low, { LowdbSync } from "lowdb";
import FileSync from "lowdb/adapters/FileSync";
import { config } from "../config";
import { Job } from "../types";

interface Schema {
  jobs: Job[];
}

let db: LowdbSync<Schema> | null = null;

function getDb(): LowdbSync<Schema> {
  if (db) return db;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const adapter = new FileSync<Schema>(path.join(config.dataDir, "jobs.json"));
  db = low(adapter);
  db.defaults({ jobs: [] }).write();
  // Nach einem Neustart laeuft kein Job mehr: haengende "generating" als fehlgeschlagen markieren
  const stuck = db.get("jobs").value().filter((j) => j.status === "generating");
  if (stuck.length) {
    stuck.forEach((j) => Object.assign(j, { status: "failed", error: "Abgebrochen durch Neustart" }));
    db.write();
    console.warn(`[jobs] ${stuck.length} haengende(n) Job(s) als fehlgeschlagen markiert`);
  }
  return db;
}

export function createJob(job: Job): void {
  getDb().get("jobs").push(job).write();
}

export function updateJob(id: string, patch: Partial<Job>): Job | undefined {
  const instance = getDb();
  instance.get("jobs").find({ id }).assign(patch).write();
  return getJob(id);
}

export function getJob(id: string): Job | undefined {
  return getDb().get("jobs").find({ id }).value();
}

export function listJobs(): Job[] {
  return [...getDb().get("jobs").value()].sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}

/** Beim Start aufrufen, damit die Bereinigung sofort laeuft */
export function initJobs(): void {
  getDb();
}
