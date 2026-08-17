import * as path from "path";
import express, { NextFunction, Request, Response } from "express";
import { nanoid } from "nanoid";
import { config } from "./config";
import { renderDeckTech, runPipeline } from "./pipeline";
import { createJob, getJob, listJobs, updateJob } from "./jobs/jobStore";
import { GeneratedTexts, Job } from "./types";

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
    "[server] BASIC_AUTH_USER/BASIC_AUTH_PASS not set - web UI is reachable WITHOUT password protection!"
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

app.listen(config.port, () => {
  console.log(`[server] mtg-insta-tool running on http://localhost:${config.port}`);
});
