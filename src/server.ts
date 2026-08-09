import * as path from "path";
import express, { NextFunction, Request, Response } from "express";
import { nanoid } from "nanoid";
import { config } from "./config";
import { runPipeline } from "./pipeline";
import { createJob, getJob, listJobs, updateJob } from "./scheduler/jobStore";
import { publishExistingJob, startScheduler } from "./scheduler/scheduler";
import { PublishJob } from "./types";

const app = express();
app.use(express.json({ limit: "2mb" }));

// --- Basic Auth (Tool laeuft oeffentlich auf einem Server, siehe README) ---
if (config.basicAuthUser && config.basicAuthPass) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? "";
    const expected =
      "Basic " + Buffer.from(`${config.basicAuthUser}:${config.basicAuthPass}`).toString("base64");
    if (header === expected) return next();
    res.set("WWW-Authenticate", 'Basic realm="mtg-insta-tool"');
    res.status(401).send("Auth required");
  });
} else {
  console.warn(
    "[server] BASIC_AUTH_USER/BASIC_AUTH_PASS nicht gesetzt - Web-UI ist OHNE Passwortschutz erreichbar!"
  );
}

app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/out", express.static(config.outDir));

function toSummary(job: PublishJob) {
  return {
    id: job.id,
    createdAt: job.createdAt,
    scheduledAt: job.scheduledAt,
    status: job.status,
    dryRun: job.dryRun,
    error: job.error,
    publishedMediaId: job.publishedMediaId,
    deckSummary: job.result?.deckSummary,
    slideUrls: job.result?.slideFiles.map(
      (f) => `/out/${job.id}/${path.basename(f)}`
    ),
    captionUrl: job.result ? `/out/${job.id}/caption.txt` : undefined,
  };
}

app.get("/api/jobs", (_req, res) => {
  res.json(listJobs().map(toSummary));
});

app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job nicht gefunden" });
  res.json({ ...toSummary(job), caption: job.result?.caption });
});

app.post("/api/jobs", async (req, res) => {
  const body = req.body ?? {};
  const kind = body.kind === "moxfield" ? "moxfield" : "raw";
  const dryRun = body.dryRun !== false; // Default: Dry-Run (siehe SPEC "Standard ist Dry-Run")
  const useLlm = body.useLlm !== false;
  const scheduledAt: string | null = body.scheduledAt || null;

  if (kind === "raw" && !body.raw) {
    return res.status(400).json({ error: "raw-Deckliste fehlt" });
  }
  if (kind === "moxfield" && !body.moxfieldUrl) {
    return res.status(400).json({ error: "moxfieldUrl fehlt" });
  }

  const jobId = nanoid(10);
  const job: PublishJob = {
    id: jobId,
    createdAt: new Date().toISOString(),
    scheduledAt,
    status: "generating",
    dryRun,
    input: { kind, raw: body.raw, moxfieldUrl: body.moxfieldUrl },
  };
  createJob(job);

  try {
    const result = await runPipeline(
      { kind, raw: body.raw, moxfieldUrl: body.moxfieldUrl },
      { jobId, useLlm }
    );

    const isFutureSchedule = !!scheduledAt && new Date(scheduledAt).getTime() > Date.now();

    updateJob(jobId, {
      status: isFutureSchedule ? "scheduled" : "ready",
      result: {
        jobDir: result.jobDir,
        slideFiles: result.slideFiles,
        captionFile: result.captionFile,
        caption: result.caption,
        deckSummary: {
          commander: result.deck.commander.name,
          cardCount: result.deck.cardCount,
          totalPriceEur: result.deck.totalPriceEur,
          colorIdentity: result.deck.colorIdentity,
        },
      },
    });

    const updated = getJob(jobId)!;

    // Sofort-Publish nur wenn explizit kein Dry-Run und keine (zukuenftige)
    // Terminierung gewaehlt wurde - Preview/Bestaetigung bleibt Pflicht
    // ueber den Client (siehe public/app.js: Bestaetigungsdialog).
    if (!dryRun && !isFutureSchedule) {
      await publishExistingJob(updated);
    }

    res.json(toSummary(getJob(jobId)!));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateJob(jobId, { status: "failed", error: message });
    res.status(500).json({ error: message, jobId });
  }
});

app.post("/api/jobs/:id/publish-now", async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job nicht gefunden" });
  if (job.status !== "ready" && job.status !== "scheduled") {
    return res.status(400).json({ error: `Job hat Status "${job.status}", kann nicht published werden` });
  }
  await publishExistingJob(job);
  res.json(toSummary(getJob(req.params.id)!));
});

app.post("/api/jobs/:id/cancel", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job nicht gefunden" });
  if (job.status !== "scheduled") {
    return res.status(400).json({ error: `Job hat Status "${job.status}", kann nicht storniert werden` });
  }
  updateJob(job.id, { status: "cancelled" });
  res.json(toSummary(getJob(req.params.id)!));
});

app.listen(config.port, () => {
  console.log(`[server] mtg-insta-tool laeuft auf http://localhost:${config.port}`);
  startScheduler();
});
