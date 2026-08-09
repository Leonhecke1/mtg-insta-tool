import * as fs from "fs";
import * as path from "path";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config, requireS3Configured } from "../config";

function client(): S3Client {
  return new S3Client({
    region: config.s3.region,
    endpoint: config.s3.endpoint,
    credentials: {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
    },
  });
}

/**
 * Laedt lokale Slide-PNGs nach S3/R2 hoch und gibt oeffentlich erreichbare
 * URLs zurueck (Instagram Graph API akzeptiert nur oeffentliche image_url,
 * siehe SPEC.md "Instagram-Publishing").
 */
export async function uploadSlides(
  files: string[],
  jobId: string
): Promise<{ key: string; url: string }[]> {
  requireS3Configured();
  const s3 = client();

  const uploaded: { key: string; url: string }[] = [];
  for (const filePath of files) {
    const fileName = path.basename(filePath);
    const key = `deck-tech/${jobId}/${fileName}`;
    const body = fs.readFileSync(filePath);

    await s3.send(
      new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: key,
        Body: body,
        ContentType: "image/png",
      })
    );

    const url = `${config.s3.publicBaseUrl.replace(/\/$/, "")}/${key}`;
    uploaded.push({ key, url });
  }

  return uploaded;
}

/** Raeumt hochgeladene Slides nach dem Publish wieder auf (SPEC.md: "danach aufraeumen") */
export async function cleanupUploaded(keys: string[]): Promise<void> {
  requireS3Configured();
  const s3 = client();
  for (const key of keys) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    } catch (err) {
      console.error(`[storage] Konnte ${key} nicht loeschen:`, err);
    }
  }
}
