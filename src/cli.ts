import * as fs from "fs";
import axios from "axios";
import { nanoid } from "nanoid";
import { runPipeline } from "./pipeline";

/**
 * Minimales CLI fuer lokales Testen der Rendering-Pipeline ohne Web-UI
 * (siehe SPEC.md MVP-Reihenfolge - "jeder Schritt einzeln testbar").
 * Rendert IMMER nur lokal, published nie automatisch.
 *
 * Usage:
 *   ts-node src/cli.ts generate ./decklist.txt [--no-llm]
 *   ts-node src/cli.ts generate --moxfield https://www.moxfield.com/decks/xxxx
 */
async function main() {
  const [, , cmd, ...rest] = process.argv;

  if (cmd !== "generate") {
    console.error("Nutzung: ts-node src/cli.ts generate <decklist.txt|--moxfield URL> [--no-llm]");
    process.exit(1);
  }

  const useLlm = !rest.includes("--no-llm");
  const moxfieldIdx = rest.indexOf("--moxfield");

  const jobId = nanoid(10);

  if (moxfieldIdx !== -1) {
    const url = rest[moxfieldIdx + 1];
    if (!url) throw new Error("--moxfield braucht eine URL");
    const result = await runPipeline({ kind: "moxfield", moxfieldUrl: url }, { jobId, useLlm });
    report(result);
    return;
  }

  const filePath = rest.find((a) => !a.startsWith("--"));
  if (!filePath) {
    console.error("Deckliste-Datei fehlt");
    process.exit(1);
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const result = await runPipeline({ kind: "raw", raw }, { jobId, useLlm });
  report(result);
}

function report(result: Awaited<ReturnType<typeof runPipeline>>) {
  console.log(`\nFertig: ${result.jobDir}`);
  console.log(`Slides: ${result.slideFiles.length}`);
  console.log(`Commander: ${result.deck.commander.name}`);
  console.log(`Karten: ${result.deck.cardCount}, Preis: ${result.deck.totalPriceEur.toFixed(2)} EUR`);
  if (result.notFoundNames.length > 0) {
    console.warn(`Nicht gefunden bei Scryfall: ${result.notFoundNames.join(", ")}`);
  }
}

main().catch((err) => {
  if (axios.isAxiosError(err)) {
    console.error(
      `HTTP-Fehler ${err.response?.status ?? ""} bei ${err.config?.url}: ${
        typeof err.response?.data === "string" ? err.response.data.slice(0, 300) : JSON.stringify(err.response?.data)
      }`
    );
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
