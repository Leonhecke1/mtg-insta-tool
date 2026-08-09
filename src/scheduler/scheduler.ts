import * as cron from "node-cron";
import { PublishJob } from "../types";
import { dueJobs, updateJob } from "./jobStore";
import { uploadSlides, cleanupUploaded } from "../publish/storage";
import { publishCarousel } from "../publish/instagram";

/**
 * Laedt die bereits gerenderten Slides eines Jobs zu S3/R2 hoch,
 * veroeffentlicht das Carousel ueber die Instagram Graph API und raeumt
 * den Zwischenspeicher danach auf. Wird sowohl fuer Sofort-Publish als
 * auch vom Scheduler-Tick fuer faellige Jobs genutzt.
 */
export async function publishExistingJob(job: PublishJob): Promise<void> {
  if (!job.result) {
    updateJob(job.id, { status: "failed", error: "Kein generiertes Ergebnis vorhanden" });
    return;
  }

  updateJob(job.id, { status: "publishing" });

  let uploaded: { key: string; url: string }[] = [];
  try {
    uploaded = await uploadSlides(job.result.slideFiles, job.id);
    const mediaId = await publishCarousel(
      uploaded.map((u) => u.url),
      job.result.caption ?? ""
    );
    updateJob(job.id, { status: "published", publishedMediaId: mediaId });
  } catch (err) {
    updateJob(job.id, {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    if (uploaded.length > 0) {
      await cleanupUploaded(uploaded.map((u) => u.key));
    }
  }
}

/**
 * Startet den Minuten-Tick, der faellige geplante Jobs (status
 * "scheduled", scheduledAt <= jetzt) findet und veroeffentlicht.
 * Der Node-Prozess muss dafuer dauerhaft laufen (siehe README:
 * Deployment via pm2/systemd).
 */
export function startScheduler(): void {
  cron.schedule("* * * * *", async () => {
    const now = new Date().toISOString();
    const due = dueJobs(now);
    for (const job of due) {
      if (job.dryRun) {
        updateJob(job.id, { status: "ready" });
        continue;
      }
      await publishExistingJob(job);
    }
  });
  console.log("[scheduler] gestartet (Minuten-Tick fuer faellige Jobs)");
}
