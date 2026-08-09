import * as fs from "fs";
import { nanoid } from "nanoid";
import { runPipeline } from "./pipeline";

/**
 * Minimales CLI fuer lokales Testen der Rendering-Pipeline ohne Web-UI
 * (siehe SPEC.md MVP-Reihenfolge - "jeder Schritt einzeln testbar").
 * Rendert immer nur lokal (Slides + caption.txt + ZIP), postet nie irgendwohin.
 *
 * Usage:
 *   ts-node src/cli.ts generate ./decklist.txt [--llm]
 *   ts-node src/cli.ts generate --moxfield https://www.moxfield.com/decks/xxxx
 *   ts-node src/cli.ts generate --archidekt https://archidekt.com/decks/xxxx
 *
 * LLM-Texte sind standardmaessig AUS (Fallback-Platzhaltertexte) - braucht
 * sonst Anthropic-API-Guthaben. Mit --llm explizit aktivieren.
 */
async function main() {
  const [, , cmd, ...rest] = process.argv;

  if (cmd !== "generate") {
    console.error(
      "Nutzung: ts-node src/cli.ts generate <decklist.txt|--moxfield URL|--archidekt URL> [--llm]"
    );
    process.exit(1);
  }

  const useLlm = rest.includes("--llm");
  const moxfieldIdx = rest.indexOf("--moxfield");
  const archidektIdx = rest.indexOf("--archidekt");

  const jobId = nanoid(10);

  if (moxfieldIdx !== -1) {
    const url = rest[moxfieldIdx + 1];
    if (!url) throw new Error("--moxfield braucht eine URL");
    const result = await runPipeline({ kind: "moxfield", moxfieldUrl: url }, { jobId, useLlm });
    report(result);
    return;
  }

  if (archidektIdx !== -1) {
    const url = rest[archidektIdx + 1];
    if (!url) throw new Error("--archidekt braucht eine URL");
    const result = await runPipeline({ kind: "archidekt", archidektUrl: url }, { jobId, useLlm });
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
  console.log(`ZIP: ${result.zipFile}`);
  console.log(`Commander: ${result.deck.commanders.map((c) => c.name).join(" & ")}`);
  console.log(`Karten: ${result.deck.cardCount}, Preis: ${result.deck.totalPriceEur.toFixed(2)} EUR`);
  if (result.usedFallbackNames.length > 0) {
    console.warn(
      `Scryfall nicht verfuegbar, Moxfield/Archidekt-Fallback-Daten genutzt fuer: ${result.usedFallbackNames.join(", ")}`
    );
  }
  if (result.notFoundNames.length > 0) {
    console.warn(`Nicht gefunden (weder Scryfall noch Fallback): ${result.notFoundNames.join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
