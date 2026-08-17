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
import { Deck, GenerateResult, GeneratedTexts, RawDeckList, SlideKind } from "./types";

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

export interface RenderedDeckTech {
  jobDir: string;
  slideFiles: string[];
  slideKinds: SlideKind[];
  captionFile: string;
  caption: string;
  zipFile: string;
}

/**
 * Instagram doesn't hyperlink URLs in captions, so the convention is either
 * the raw decklist link (still useful to paste/copy) when we actually have
 * one (Moxfield/Archidekt import), or a "link in bio" pointer when we don't
 * (raw-text import has no source URL). Always appended - a caption without
 * any way back to the decklist is a caption nobody can act on.
 */
function buildCaptionText(body: string, hashtags: string[], sourceUrl?: string): string {
  const linkLine = sourceUrl ? `Full decklist: ${sourceUrl}` : "Full decklist: link in bio";
  return `${body}\n\n${linkLine}\n\n${hashtags.join(" ")}\n`;
}

/**
 * Rendert Slides + caption.txt + ZIP aus einem bereits angereicherten Deck
 * und fertigen Texten. Getrennt von runPipeline(), damit Text-Bearbeitung
 * im Web-UI (siehe server.ts POST /api/jobs/:id/texts) nur neu rendern
 * muss, ohne Parser/Scryfall/LLM erneut anzustossen.
 */
export async function renderDeckTech(
  deck: Deck,
  texts: GeneratedTexts,
  jobId: string,
  sourceUrl?: string
): Promise<RenderedDeckTech> {
  const builtSlides = buildSlides(deck, texts);
  const htmlSlides = builtSlides.map((s) => s.html);
  const slideKinds = builtSlides.map((s) => s.kind);

  const jobDir = path.join(config.outDir, jobId);
  const slideFiles = await renderSlidesToFiles(htmlSlides, jobDir);

  const caption = buildCaptionText(texts.caption.body, texts.caption.hashtags, sourceUrl);
  const captionFile = path.join(jobDir, "caption.txt");
  fs.writeFileSync(captionFile, caption, "utf-8");

  const zipFile = await buildZip(jobDir, [...slideFiles, captionFile]);

  return { jobDir, slideFiles, slideKinds, captionFile, caption, zipFile };
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
  const sourceUrl = input.moxfieldUrl ?? input.archidektUrl;
  const rendered = await renderDeckTech(deck, texts, opts.jobId, sourceUrl);

  return {
    ...rendered,
    deck,
    texts,
    notFoundNames,
    usedFallbackNames,
  };
}
