import * as path from "path";
import express from "express";
import { nanoid } from "nanoid";
import { config, instagramConfigured } from "./config";
import { renderDeckTech, runPipeline } from "./pipeline";
import { createJob, getJob, listJobs, updateJob } from "./jobs/jobStore";
import { GeneratedTexts, Job } from "./types";
import { ensureJpegs } from "./render/renderer";
import { buildReel, reelCoverPath, reelScript } from "./render/reel";
import {
  addItem,
  getItem,
  getItemByToken,
  listItems,
  QueueItem,
  QueueKind,
  updateItem,
} from "./queue/queueStore";
import { mediaUrls, runSchedulerNow, startScheduler } from "./queue/scheduler";
import { fetchNextDeck, planInfo } from "./sourcing/dailyDeck";
import * as fs from "fs";
import { authEnabled, handleLogin, handleLogout, requireAuth } from "./auth";
import {
  addSubscription,
  notify,
  removeSubscription,
  subscriptionCount,
  vapidPublicKey,
} from "./push/push";

const app = express();
// Hinter Caddy: echte Client-IP und https-Erkennung (Secure-Cookie)
app.set("trust proxy", true);
app.use(express.json({ limit: "2mb" }));

// --- Oeffentliche Media-URLs fuer die Instagram-API (VOR Basic Auth) ---
// Instagram laedt Bilder/Videos selbst per URL. Nur Dateien von Queue-Items
// sind erreichbar, und nur ueber deren unratbaren Token.
app.get("/media/:token/:file", (req, res) => {
  const item = getItemByToken(req.params.token);
  const index = parseInt(req.params.file, 10);
  if (!item || item.status === "rejected" || !(index >= 0) || !item.mediaFiles[index]) {
    return res.status(404).end();
  }
  res.sendFile(item.mediaFiles[index]);
});

// --- Login (Cookie statt Basic Auth, damit die iOS-Web-App funktioniert) ---
app.post("/api/login", handleLogin);
app.post("/api/logout", handleLogout);
if (authEnabled()) {
  app.use(requireAuth);
} else {
  console.warn(
    "[server] BASIC_AUTH_USER/BASIC_AUTH_PASS not set - web UI is reachable WITHOUT password protection!"
  );
}

app.use(
  express.static(path.join(__dirname, "..", "public"), {
    setHeaders: (res, file) => {
      // Service Worker nie cachen, sonst kommen Updates nicht an
      if (file.endsWith("sw.js")) res.setHeader("Cache-Control", "no-cache");
    },
  })
);

// --- Push-Benachrichtigungen ---
app.get("/api/push/key", (_req, res) => {
  res.json({ publicKey: vapidPublicKey(), subscriptions: subscriptionCount() });
});
app.post("/api/push/subscribe", (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return res.status(400).json({ error: "invalid subscription" });
  }
  addSubscription(sub);
  res.json({ ok: true });
});
app.post("/api/push/unsubscribe", (req, res) => {
  if (req.body?.endpoint) removeSubscription(req.body.endpoint);
  res.json({ ok: true });
});
app.post("/api/push/test", async (_req, res) => {
  await notify({ title: "floating.mana", body: "Benachrichtigungen funktionieren.", tag: "test" });
  res.json({ ok: true, subscriptions: subscriptionCount() });
});
app.use("/out", express.static(config.outDir));

function toSummary(job: Job) {
  return {
    id: job.id,
    createdAt: job.createdAt,
    status: job.status,
    error: job.error,
    deckSummary: job.result?.deckSummary,
    slideUrls: job.result?.slideFiles.map((f) => `/out/${job.id}/${path.basename(f)}`),
    slideKinds: job.result?.slideKinds,
    captionUrl: job.result ? `/out/${job.id}/caption.txt` : undefined,
    zipUrl: job.result ? `/out/${job.id}/${path.basename(job.result.zipFile)}` : undefined,
    usedFallbackNames: job.result?.usedFallbackNames ?? [],
  };
}

app.get("/api/jobs", (_req, res) => {
  res.json(listJobs().map(toSummary));
});

app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json({
    ...toSummary(job),
    caption: job.result?.caption,
    texts: job.result?.texts,
  });
});

app.post("/api/jobs", async (req, res) => {
  const body = req.body ?? {};
  const kind =
    body.kind === "moxfield" ? "moxfield" : body.kind === "archidekt" ? "archidekt" : "raw";
  const useLlm = body.useLlm === true;

  if (kind === "raw" && !body.raw) {
    return res.status(400).json({ error: "raw decklist missing" });
  }
  if (kind === "moxfield" && !body.moxfieldUrl) {
    return res.status(400).json({ error: "moxfieldUrl missing" });
  }
  if (kind === "archidekt" && !body.archidektUrl) {
    return res.status(400).json({ error: "archidektUrl missing" });
  }

  const jobId = nanoid(10);
  const job: Job = {
    id: jobId,
    createdAt: new Date().toISOString(),
    status: "generating",
    input: { kind, raw: body.raw, moxfieldUrl: body.moxfieldUrl, archidektUrl: body.archidektUrl },
  };
  createJob(job);

  try {
    const result = await runPipeline(
      { kind, raw: body.raw, moxfieldUrl: body.moxfieldUrl, archidektUrl: body.archidektUrl },
      { jobId, useLlm }
    );

    updateJob(jobId, {
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
    });

    res.json(toSummary(getJob(jobId)!));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateJob(jobId, { status: "failed", error: message });
    res.status(500).json({ error: message, jobId });
  }
});

/**
 * Eigene Texte hinterlegen (v.a. wenn kein LLM konfiguriert ist): Body
 * enthaelt nur die zu aendernden Felder von GeneratedTexts (tagline,
 * gameplan, caption), Rest bleibt wie zuletzt. Rendert danach
 * Slides/Caption/ZIP neu, OHNE Parser/Scryfall/LLM erneut anzustossen.
 */
app.post("/api/jobs/:id/texts", async (req, res) => {
  const job = getJob(req.params.id);
  if (!job?.result) {
    return res.status(404).json({ error: "Job (with result) not found" });
  }

  const patch = req.body ?? {};
  const merged: GeneratedTexts = {
    tagline: typeof patch.tagline === "string" ? patch.tagline : job.result.texts.tagline,
    flavor: typeof patch.flavor === "string" ? patch.flavor : job.result.texts.flavor,
    gameplan: patch.gameplan ?? job.result.texts.gameplan,
    caption: patch.caption ?? job.result.texts.caption,
  };

  try {
    const sourceUrl = job.input.moxfieldUrl ?? job.input.archidektUrl;
    const rendered = await renderDeckTech(job.result.deck, merged, job.id, sourceUrl);
    updateJob(job.id, {
      status: "ready",
      result: {
        ...job.result,
        slideFiles: rendered.slideFiles,
        slideKinds: rendered.slideKinds,
        captionFile: rendered.captionFile,
        zipFile: rendered.zipFile,
        caption: rendered.caption,
        texts: merged,
      },
    });
    res.json({ ...toSummary(getJob(job.id)!), texts: merged });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// Freigabe-Queue (UI: /queue.html). Nichts wird ohne "approve" veroeffentlicht.
// ---------------------------------------------------------------------------

function toQueueSummary(item: QueueItem) {
  return {
    ...item,
    mediaFiles: undefined,
    previewUrls: item.mediaFiles.map(
      (f, i) => `/media/${item.mediaToken}/${i}${path.extname(f)}`
    ),
    publicUrls: config.publicBaseUrl ? mediaUrls(item) : [],
  };
}

function validateForApproval(item: QueueItem): string | null {
  if (item.kind === "comment_reply") {
    return item.replyText?.trim() ? null : "Reply text is empty";
  }
  if (item.mediaFiles.length === 0) return "No media";
  if (item.kind === "carousel" && item.mediaFiles.length > 10) return "Max. 10 slides per carousel";
  if (item.mediaFiles.some((f) => !fs.existsSync(f))) return "Media file missing on disk";
  return null;
}

app.get("/api/queue", (_req, res) => {
  res.json(listItems().map(toQueueSummary));
});

/**
 * Neues Item aus einem fertigen Job anlegen (Status: draft).
 * Body: { jobId, kind: "carousel"|"image"|"story", scheduledAt, slides?: number[] (1-basiert), caption? }
 *   oder { kind: "reel", videoFile (Pfad relativ zu OUT_DIR), scheduledAt, caption }
 */
app.post("/api/queue", async (req, res) => {
  const body = req.body ?? {};
  const kind = body.kind as QueueKind;
  if (!["carousel", "image", "story", "reel"].includes(kind)) {
    return res.status(400).json({ error: "kind must be carousel|image|story|reel" });
  }
  const scheduledAt = new Date(body.scheduledAt ?? Date.now());
  if (isNaN(scheduledAt.getTime())) return res.status(400).json({ error: "invalid scheduledAt" });

  try {
    let mediaFiles: string[] = [];
    let caption: string | undefined = body.caption;
    let label = body.label as string | undefined;

    if (kind === "reel" && body.jobId) {
      // Animiertes Reel aus dem Deck (eigene Szenen, kein Slide-Zoom)
      const job = getJob(body.jobId);
      if (!job?.result) return res.status(404).json({ error: "Job (with result) not found" });
      const hookIn = typeof body.hook === "string" ? body.hook : undefined;
      const video = await buildReel(job.result.deck, job.result.jobDir, { hook: hookIn });
      const hook = reelScript(job.result.deck, hookIn).hook;
      const cover = reelCoverPath(video);
      mediaFiles = fs.existsSync(cover) ? [video, cover] : [video];
      caption = caption ?? job.result.caption;
      label = label ?? `${job.result.deckSummary?.commander ?? ""} · "${hook}"`;
    } else if (kind === "reel") {
      const video = path.resolve(config.outDir, String(body.videoFile ?? ""));
      if (!video.startsWith(config.outDir + path.sep) || !fs.existsSync(video)) {
        return res.status(400).json({ error: "videoFile not found in OUT_DIR" });
      }
      mediaFiles = [video];
    } else {
      const job = getJob(body.jobId);
      if (!job?.result) return res.status(404).json({ error: "Job (with result) not found" });
      let pngs = job.result.slideFiles;
      if (Array.isArray(body.slides) && body.slides.length) {
        pngs = body.slides.map((n: number) => pngs[n - 1]).filter(Boolean);
      }
      if (kind !== "carousel") pngs = pngs.slice(0, 1);
      mediaFiles = await ensureJpegs(pngs);
      caption = caption ?? job.result.caption;
      label = label ?? job.result.deckSummary?.commander;
    }

    const item: QueueItem = {
      id: nanoid(10),
      kind,
      status: "draft",
      createdAt: new Date().toISOString(),
      scheduledAt: scheduledAt.toISOString(),
      mediaToken: nanoid(24),
      mediaFiles,
      caption: kind === "story" ? undefined : caption,
      sourceJobId: body.jobId,
      label,
    };
    addItem(item);
    res.json(toQueueSummary(item));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.patch("/api/queue/:id", (req, res) => {
  const item = getItem(req.params.id);
  if (!item) return res.status(404).json({ error: "not found" });
  if (!["draft", "approved", "failed"].includes(item.status)) {
    return res.status(409).json({ error: `cannot edit item in status ${item.status}` });
  }
  const b = req.body ?? {};
  const patch: Partial<QueueItem> = {};
  if (typeof b.caption === "string") patch.caption = b.caption;
  if (typeof b.replyText === "string") patch.replyText = b.replyText;
  if (b.scheduledAt) {
    const d = new Date(b.scheduledAt);
    if (isNaN(d.getTime())) return res.status(400).json({ error: "invalid scheduledAt" });
    patch.scheduledAt = d.toISOString();
  }
  // Jede inhaltliche Aenderung braucht eine neue Freigabe
  if (item.status !== "draft") patch.status = "draft";
  res.json(toQueueSummary(updateItem(item.id, patch)!));
});

app.get("/api/plan/info", (_req, res) => {
  res.json({ ...planInfo(), instagram: instagramConfigured() });
});

app.post("/api/queue/fetch-deck", async (req, res) => {
  try {
    const day = typeof req.body?.day === "string" ? req.body.day : undefined;
    res.json(await fetchNextDeck(day));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/queue/approve-all", (_req, res) => {
  const approved: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const item of listItems().filter((i) => i.status === "draft")) {
    const problem = validateForApproval(item);
    if (problem) skipped.push({ id: item.id, reason: problem });
    else {
      updateItem(item.id, { status: "approved" });
      approved.push(item.id);
    }
  }
  res.json({ approved, skipped });
});

app.post("/api/queue/:id/approve", (req, res) => {
  const item = getItem(req.params.id);
  if (!item) return res.status(404).json({ error: "not found" });
  if (!["draft", "failed"].includes(item.status)) {
    return res.status(409).json({ error: `cannot approve item in status ${item.status}` });
  }
  const problem = validateForApproval(item);
  if (problem) return res.status(400).json({ error: problem });
  res.json(toQueueSummary(updateItem(item.id, { status: "approved", error: undefined })!));
});

/** Freigeben und sofort veroeffentlichen */
app.post("/api/queue/:id/post-now", (req, res) => {
  const item = getItem(req.params.id);
  if (!item) return res.status(404).json({ error: "not found" });
  if (!["draft", "approved", "failed"].includes(item.status)) {
    return res.status(409).json({ error: `cannot post item in status ${item.status}` });
  }
  if (!instagramConfigured()) return res.status(400).json({ error: "Instagram ist nicht verbunden" });
  const problem = validateForApproval(item);
  if (problem) return res.status(400).json({ error: problem });
  const updated = updateItem(item.id, {
    status: "approved",
    scheduledAt: new Date().toISOString(),
    error: undefined,
  })!;
  runSchedulerNow();
  res.json(toQueueSummary(updated));
});

app.post("/api/queue/:id/reject", (req, res) => {
  const item = getItem(req.params.id);
  if (!item) return res.status(404).json({ error: "not found" });
  if (["publishing", "published"].includes(item.status)) {
    return res.status(409).json({ error: `cannot reject item in status ${item.status}` });
  }
  res.json(toQueueSummary(updateItem(item.id, { status: "rejected" })!));
});

app.listen(config.port, () => {
  console.log(`[server] mtg-insta-tool running on http://localhost:${config.port}`);
  startScheduler();
});
