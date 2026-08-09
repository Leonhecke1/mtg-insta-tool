import * as path from "path";
import express, { NextFunction, Request, Response } from "express";
import { nanoid } from "nanoid";
import { config } from "./config";
import { runPipeline } from "./pipeline";
import { createJob, getJob, listJobs, updateJob } from "./jobs/jobStore";
import { Job } from "./types";

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

function toSummary(job: Job) {
  return {
    id: job.id,
    createdAt: job.createdAt,
    status: job.status,
    error: job.error,
    deckSummary: job.result?.deckSummary,
    slideUrls: job.result?.slideFiles.map((f) => `/out/${job.id}/${path.basename(f)}`),
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
  if (!job) return res.status(404).json({ error: "Job nicht gefunden" });
  res.json({ ...toSummary(job), caption: job.result?.caption });
});

app.post("/api/jobs", async (req, res) => {
  const body = req.body ?? {};
  const kind =
    body.kind === "moxfield" ? "moxfield" : body.kind === "archidekt" ? "archidekt" : "raw";
  const useLlm = body.useLlm !== false;

  if (kind === "raw" && !body.raw) {
    return res.status(400).json({ error: "raw-Deckliste fehlt" });
  }
  if (kind === "moxfield" && !body.moxfieldUrl) {
    return res.status(400).json({ error: "moxfieldUrl fehlt" });
  }
  if (kind === "archidekt" && !body.archidektUrl) {
    return res.status(400).json({ error: "archidektUrl fehlt" });
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
        captionFile: result.captionFile,
        zipFile: result.zipFile,
        caption: result.caption,
        usedFallbackNames: result.usedFallbackNames,
        deckSummary: {
          commander: result.deck.commander.name,
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

app.listen(config.port, () => {
  console.log(`[server] mtg-insta-tool laeuft auf http://localhost:${config.port}`);
});
