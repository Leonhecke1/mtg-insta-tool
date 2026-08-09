import * as fs from "fs";
import * as path from "path";
import archiver from "archiver";

/**
 * Packt die Slides + caption.txt einer Deck-Tech in eine ZIP-Datei
 * (out/<jobId>/deck-tech.zip). Das ist der eigentliche Endpunkt der
 * Pipeline - kein automatischer Instagram-Upload, siehe README.
 */
export async function buildZip(jobDir: string, files: string[]): Promise<string> {
  const zipPath = path.join(jobDir, "deck-tech.zip");

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve());
    archive.on("error", (err) => reject(err));
    archive.pipe(output);

    for (const file of files) {
      archive.file(file, { name: path.basename(file) });
    }

    archive.finalize();
  });

  return zipPath;
}
