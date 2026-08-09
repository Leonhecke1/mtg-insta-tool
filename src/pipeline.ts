import * as fs from "fs";
import * as path from "path";
import { config } from "./config";
import { parseRawDecklist } from "./parser/rawtext";
import { fetchMoxfieldDeck } from "./parser/moxfield";
import { enrichDeck } from "./scryfall/enrich";
import { generateTexts } from "./llm/anthropic";
import { buildSlides } from "./render/slideBuilder";
import { renderSlidesToFiles } from "./render/renderer";
import { GenerateResult, RawDeckList } from "./types";

export interface PipelineInput {
  kind: "raw" | "moxfield";
  raw?: string;
  moxfieldUrl?: string;
}

export interface PipelineOptions {
  jobId: string;
  useLlm: boolean;
}

function buildCaptionText(body: string, hashtags: string[]): string {
  return `${body}\n\n${hashtags.join(" ")}\n`;
}

/**
 * Fuehrt die komplette Rendering-Pipeline aus (SPEC.md
 * "Rendering-Pipeline"): Deckliste -> Parser -> Scryfall-Anreicherung ->
 * HTML-Templates -> Puppeteer-Screenshots -> lokale Dateien. Legt IMMER
 * zuerst lokal ab (out/<jobId>/slide-XX.png + caption.txt); Publishing ist
 * ein separater Schritt (siehe src/publish/).
 */
export async function runPipeline(
  input: PipelineInput,
  opts: PipelineOptions
): Promise<GenerateResult> {
  let raw: RawDeckList;
  if (input.kind === "moxfield") {
    if (!input.moxfieldUrl) throw new Error("moxfieldUrl fehlt");
    raw = await fetchMoxfieldDeck(input.moxfieldUrl);
  } else {
    if (!input.raw) throw new Error("Deckliste (raw) fehlt");
    raw = parseRawDecklist(input.raw);
  }

  const { deck, notFoundNames } = await enrichDeck(raw);
  const texts = await generateTexts(deck, opts.useLlm);
  const htmlSlides = buildSlides(deck, texts);

  const jobDir = path.join(config.outDir, opts.jobId);
  const slideFiles = await renderSlidesToFiles(htmlSlides, jobDir);

  const caption = buildCaptionText(texts.caption.body, texts.caption.hashtags);
  const captionFile = path.join(jobDir, "caption.txt");
  fs.writeFileSync(captionFile, caption, "utf-8");

  return {
    jobDir,
    slideFiles,
    captionFile,
    caption,
    deck,
    texts,
    notFoundNames,
  };
}
