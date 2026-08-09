import * as fs from "fs";
import * as path from "path";
import low, { LowdbSync } from "lowdb";
import FileSync from "lowdb/adapters/FileSync";
import { config } from "../config";
import { PublishJob } from "../types";

interface Schema {
  jobs: PublishJob[];
}

let db: LowdbSync<Schema> | null = null;

function getDb(): LowdbSync<Schema> {
  if (db) return db;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const adapter = new FileSync<Schema>(path.join(config.dataDir, "jobs.json"));
  db = low(adapter);
  db.defaults({ jobs: [] }).write();
  return db;
}

export function createJob(job: PublishJob): void {
  getDb().get("jobs").push(job).write();
}

export function updateJob(id: string, patch: Partial<PublishJob>): PublishJob | undefined {
  const instance = getDb();
  instance.get("jobs").find({ id }).assign(patch).write();
  return getJob(id);
}

export function getJob(id: string): PublishJob | undefined {
  return getDb().get("jobs").find({ id }).value();
}

export function listJobs(): PublishJob[] {
  return [...getDb().get("jobs").value()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function dueJobs(nowIso: string): PublishJob[] {
  return getDb()
    .get("jobs")
    .filter(
      (j: PublishJob) =>
        j.status === "scheduled" && j.scheduledAt !== null && j.scheduledAt <= nowIso
    )
    .value();
}
