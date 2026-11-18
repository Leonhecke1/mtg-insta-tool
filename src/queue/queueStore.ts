import * as fs from "fs";
import * as path from "path";
import low, { LowdbSync } from "lowdb";
import FileSync from "lowdb/adapters/FileSync";
import { config } from "../config";

/**
 * Freigabe-Warteschlange. Alles, was oeffentlich unter dem Account erscheint,
 * geht hier durch: erst "draft", dann vom Menschen "approved", erst dann
 * veroeffentlicht der Scheduler es zur geplanten Zeit.
 */

export type QueueKind = "carousel" | "image" | "story" | "reel" | "comment_reply";
export type QueueStatus =
  | "draft"
  | "approved"
  | "rejected"
  | "publishing"
  | "published"
  | "failed";

export interface QueueItem {
  id: string;
  kind: QueueKind;
  status: QueueStatus;
  createdAt: string;
  scheduledAt: string; // ISO; Replies: sofort nach Freigabe
  /** Unratbarer Token fuer die oeffentliche Media-URL (/media/<token>/<n>) */
  mediaToken: string;
  /** Absolute Pfade (JPEG bzw. MP4) */
  mediaFiles: string[];
  caption?: string;
  /** comment_reply */
  commentId?: string;
  commentText?: string;
  commentUsername?: string;
  replyText?: string;
  sourceJobId?: string;
  label?: string;
  publishedId?: string;
  publishedAt?: string;
  error?: string;
  /** Wird nach dem Veroeffentlichen als erster Kommentar gepostet (z. B. Decklisten-Link) */
  firstComment?: string;
  /** "news" = zusaetzlicher Beitrag, blockiert keinen Tag im Wochenplan */
  origin?: "news";
  /** Commander-Spellbook-ID bei Combo-Reels */
  comboId?: string;
  /** Suchbegriffe fuer den Caption-Linter */
  keywords?: string[];
  /** Wann zuletzt per Push an die fehlende Freigabe erinnert wurde */
  remindedAt?: string;
}

interface Schema {
  items: QueueItem[];
  seenCommentIds: string[];
}

let db: LowdbSync<Schema> | null = null;

function getDb(): LowdbSync<Schema> {
  if (db) return db;
  fs.mkdirSync(config.dataDir, { recursive: true });
  db = low(new FileSync<Schema>(path.join(config.dataDir, "queue.json")));
  db.defaults({ items: [], seenCommentIds: [] }).write();
  return db;
}

export function addItem(item: QueueItem): void {
  getDb().get("items").push(item).write();
}

export function updateItem(id: string, patch: Partial<QueueItem>): QueueItem | undefined {
  getDb().get("items").find({ id }).assign(patch).write();
  return getItem(id);
}

export function getItem(id: string): QueueItem | undefined {
  return getDb().get("items").find({ id }).value();
}

export function getItemByToken(token: string): QueueItem | undefined {
  return getDb().get("items").find({ mediaToken: token }).value();
}

export function listItems(): QueueItem[] {
  return [...getDb().get("items").value()].sort((a, b) =>
    a.scheduledAt.localeCompare(b.scheduledAt)
  );
}

export function dueApprovedItems(now = new Date()): QueueItem[] {
  return listItems().filter(
    (i) => i.status === "approved" && new Date(i.scheduledAt).getTime() <= now.getTime()
  );
}

export function isCommentSeen(commentId: string): boolean {
  return getDb().get("seenCommentIds").includes(commentId).value();
}

export function markCommentSeen(commentId: string): void {
  if (!isCommentSeen(commentId)) getDb().get("seenCommentIds").push(commentId).write();
}
