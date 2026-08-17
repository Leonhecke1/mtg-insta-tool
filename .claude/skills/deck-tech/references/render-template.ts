// Copy to ../../../scratch_render.ts (repo root), fill in the URL + texts, run with:
//   npx ts-node scratch_render.ts
// Delete the file when done - see SKILL.md step 5.

import { nanoid } from "nanoid";
import { fetchArchidektDeck } from "./src/parser/archidekt";
import { enrichDeck } from "./src/scryfall/enrich";
import { renderDeckTech } from "./src/pipeline";
import { GeneratedTexts } from "./src/types";

const SOURCE_URL = "https://archidekt.com/decks/REPLACE_ME/deck-slug";

// Write every field by hand from the dump in step 1 - see SKILL.md step 2
// for the tone/length rules for each field.
const texts: GeneratedTexts = {
  tagline: "REPLACE - one punchy sentence, <=90 chars, naming the real line of play.",
  flavor: "REPLACE - <=40 chars, moody in-world badge line, not a literal label.",
  gameplan: {
    paragraphs: [
      "REPLACE - paragraph 1: the commander's core loop, named cards.",
      "REPLACE - paragraph 2: the supporting package that enables/scales it.",
      "REPLACE - paragraph 3: the finisher(s).",
    ],
    steps: ["REPLACE - step 1", "REPLACE - step 2", "REPLACE - step 3"],
  },
  caption: {
    body: "REPLACE - 2-4 sentences for the Instagram caption.",
    hashtags: [
      "#edh",
      "#commander",
      "#mtg",
      "#magicthegathering",
      "#deckTech",
      // REPLACE - add deck-specific tags (color combo, archetype, commander name)
    ],
  },
};

async function main() {
  const raw = await fetchArchidektDeck(SOURCE_URL);
  const { deck, notFoundNames, usedFallbackNames } = await enrichDeck(raw);

  const jobId = nanoid(10);
  const rendered = await renderDeckTech(deck, texts, jobId, SOURCE_URL);

  console.log("jobDir", rendered.jobDir);
  console.log("slides", rendered.slideFiles.length);
  console.log("kinds", rendered.slideKinds);
  console.log("notFound", notFoundNames);
  console.log("usedFallback", usedFallbackNames);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
