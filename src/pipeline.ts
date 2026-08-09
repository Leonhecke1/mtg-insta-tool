import * as fs from "fs";
import * as path from "path";
import { config } from "./config";
import { parseRawDecklist } from "./parser/rawtext";
import { fetchMoxfieldDeck } from "./parser/moxfield";
import { fetchArchidektDeck } from "./parser/archidekt";
import { enrichDeck } from "./scryfall/enrich";
import { generateTexts } from "./llm/anthropic";
import { buildSlides } from "./render/slideBuilder";
import { renderSlidesToFiles } from "./render/renderer";
import { buildZip } from "./output/zip";
import { GenerateResult, RawDeckList } from "./types";

export interface PipelineInput {
  kind: "raw" | "moxfield" | "archidekt";
  raw?: string;
  moxfieldUrl?: string;
  archidektUrl?: string;
}

export interface PipelineOptions {
  jobId: string;
  useLlm: boolean;
}

function buildCaptionText(body: string, hashtags: string[]): string {
  return `${body}\n\n${hashtags.join(" ")}\n`;
}

/**
 * Fuehrt die komplette Rendering-Pipeline aus: Deckliste -> Parser ->
 * Scryfall-Anreicherung -> HTML-Templates -> Puppeteer-Screenshots ->
 * lokale Dateien -> ZIP. Es gibt bewusst KEINEN automatischen Upload
 * irgendwohin (auch nicht zu Instagram) - das ZIP (Slides + caption.txt)
 * ist das Endergebnis, das der Nutzer selbst weiterverwendet.
 */
export async function runPipeline(
  input: PipelineInput,
  opts: PipelineOptions
): Promise<GenerateResult> {
  let raw: RawDeckList;
  if (input.kind === "moxfield") {
    if (!input.moxfieldUrl) throw new Error("moxfieldUrl fehlt");
    raw = await fetchMoxfieldDeck(input.moxfieldUrl);
  } else if (input.kind === "archidekt") {
    if (!input.archidektUrl) throw new Error("archidektUrl fehlt");
    raw = await fetchArchidektDeck(input.archidektUrl);
  } else {
    if (!input.raw) throw new Error("Deckliste (raw) fehlt");
    raw = parseRawDecklist(input.raw);
  }

  const { deck, notFoundNames, usedFallbackNames } = await enrichDeck(raw);
  const texts = await generateTexts(deck, opts.useLlm);
  const htmlSlides = buildSlides(deck, texts);

  const jobDir = path.join(config.outDir, opts.jobId);
  const slideFiles = await renderSlidesToFiles(htmlSlides, jobDir);

  const caption = buildCaptionText(texts.caption.body, texts.caption.hashtags);
  const captionFile = path.join(jobDir, "caption.txt");
  fs.writeFileSync(captionFile, caption, "utf-8");

  const zipFile = await buildZip(jobDir, [...slideFiles, captionFile]);

  return {
    jobDir,
    slideFiles,
    captionFile,
    caption,
    zipFile,
    deck,
    texts,
    notFoundNames,
    usedFallbackNames,
  };
}
