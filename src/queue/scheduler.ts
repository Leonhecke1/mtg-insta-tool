import * as path from "path";
import { config, instagramConfigured } from "../config";
import {
  fetchRecentComments,
  publishCarousel,
  publishImage,
  publishReel,
  publishStory,
  replyToComment,
} from "../instagram/client";
import { draftReply } from "../llm/replyDrafter";
import { refreshTokenIfDue } from "../instagram/token";
import { nanoid } from "nanoid";
import {
  addItem,
  dueApprovedItems,
  isCommentSeen,
  markCommentSeen,
  QueueItem,
  updateItem,
} from "./queueStore";

/**
 * Scheduler im Server-Prozess:
 *  - veroeffentlicht FREIGEGEBENE Items, sobald ihre Zeit erreicht ist
 *  - holt neue Kommentare unter eigenen Posts und legt Antwort-ENTWUERFE an
 * Nichts geht ohne Status "approved" raus.
 */

export function mediaUrls(item: QueueItem): string[] {
  return item.mediaFiles.map(
    (f, i) => `${config.publicBaseUrl}/media/${item.mediaToken}/${i}${path.extname(f)}`
  );
}

async function publish(item: QueueItem): Promise<string> {
  const urls = mediaUrls(item);
  const caption = item.caption ?? "";
  switch (item.kind) {
    case "carousel":
      return publishCarousel(urls, caption);
    case "image":
      return publishImage(urls[0], caption);
    case "story":
      return publishStory(urls[0]);
    case "reel":
      return publishReel(urls[0], caption);
    case "comment_reply":
      if (!item.commentId || !item.replyText) throw new Error("reply without text/commentId");
      return replyToComment(item.commentId, item.replyText);
  }
}

let running = false;

async function publishDue(): Promise<void> {
  for (const item of dueApprovedItems()) {
    updateItem(item.id, { status: "publishing", error: undefined });
    try {
      const publishedId = await publish(item);
      updateItem(item.id, {
        status: "published",
        publishedId,
        publishedAt: new Date().toISOString(),
      });
      console.log(`[scheduler] published ${item.kind} ${item.id} -> ${publishedId}`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      updateItem(item.id, { status: "failed", error });
      console.error(`[scheduler] ${item.kind} ${item.id} failed: ${error}`);
    }
  }
}

let lastCommentPoll = 0;

async function pollComments(): Promise<void> {
  if (Date.now() - lastCommentPoll < config.commentPollMinutes * 60_000) return;
  lastCommentPoll = Date.now();

  const comments = await fetchRecentComments();
  for (const c of comments) {
    if (c.repliedByMe || isCommentSeen(c.id)) continue;
    markCommentSeen(c.id);

    let replyText = "";
    try {
      replyText = await draftReply(c.text, c.username, c.mediaCaption);
    } catch (err) {
      console.error("[scheduler] reply draft failed:", err);
    }
    if (replyText === "SKIP") continue;

    addItem({
      id: nanoid(10),
      kind: "comment_reply",
      status: "draft",
      createdAt: new Date().toISOString(),
      scheduledAt: new Date().toISOString(),
      mediaToken: nanoid(24),
      mediaFiles: [],
      commentId: c.id,
      commentText: c.text,
      commentUsername: c.username,
      replyText,
      label: `Reply to @${c.username}`,
    });
  }
}

let lastTokenCheck = 0;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    if (Date.now() - lastTokenCheck > 6 * 3600_000) {
      lastTokenCheck = Date.now();
      await refreshTokenIfDue().catch((err) => console.error("[scheduler]", err.message));
    }
    await publishDue();
    await pollComments();
  } catch (err) {
    console.error("[scheduler] tick failed:", err);
  } finally {
    running = false;
  }
}

export function startScheduler(): void {
  if (!instagramConfigured()) {
    console.warn(
      "[scheduler] IG_USER_ID / IG_ACCESS_TOKEN / PUBLIC_BASE_URL not set - auto-publishing disabled"
    );
    return;
  }
  console.log(`[scheduler] running every ${config.schedulerIntervalSec}s`);
  setInterval(tick, config.schedulerIntervalSec * 1000);
  void tick();
}
