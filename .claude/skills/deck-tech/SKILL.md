---
name: deck-tech
description: Generate an Instagram deck-tech carousel (slides + caption) for an Archidekt Commander/EDH deck URL. Use whenever the user pastes an archidekt.com/decks/... link and asks to make/render/create the deck (tech), regenerate a previously-run deck, or wants the slides redone after a code/design change. Writes the tagline/flavor/gameplan/caption copy by hand instead of via the LLM path.
tools: Read, Write, Bash, AskUserQuestion
---

# Deck Tech Generator

Turns an Archidekt Commander deck URL into a full rendered slide carousel (`out/<jobId>/slide-*.png` + `caption.txt` + `deck-tech.zip`), with hand-written slide copy that actually reflects the deck's real combo lines - not generic filler.

**Why hand-written copy:** the LLM path (`generateTexts` in `src/llm/anthropic.ts`, triggered by `--llm` or the web UI's checkbox) needs a funded `ANTHROPIC_API_KEY`. Unless the user confirms that's set up and working, assume it isn't and write the copy yourself by calling `renderDeckTech` directly with a hand-built `GeneratedTexts` object. This produces sharper, more specific copy anyway - it can cite exact card names and interactions instead of generic archetype summaries.

## Workflow

### 1. Dump the decklist

Write a throwaway script (see `references/dump-template.ts`) that calls `fetchArchidektDeck` + `enrichDeck` and prints the commander(s)' oracle text plus every mainboard/maybeboard card with type line and oracle text. Run it with `npx ts-node scratch_dump.ts`.

Read the **actual oracle text** printed, don't guess from the card name. If the user describes the deck's plan in their prompt, treat that as a strong hint pointing at the right cards, but verify it against what's actually printed - their phrasing is sometimes a little off (e.g. "the commander loots" when it actually exiles, or "resets each turn" when it's actually keyed to a specific ability instance), and the copy should describe the mechanic precisely.

**If the commander lookup throws** ("Could not find a commander... expected a card with category 'Commander'"): the user hasn't tagged a Commander category on Archidekt yet. Tell them and wait rather than guessing which legendary creature is meant - unless it's structurally obvious (e.g. only one legendary creature outside a "Maybeboard").

**If a commander's `oracleText` comes back blank or suspiciously short** (common for transforming/modal DFCs where Archidekt's fallback data only has partial text): fetch it directly, e.g.:

```bash
curl -s "https://api.scryfall.com/cards/named?fuzzy=<url-encoded-name>" \
  -H "User-Agent: mtg-insta-tool/0.1 (+https://github.com/)" -H "Accept: application/json"
```

Getting the mechanic exactly right (which zone, which trigger condition, once-per-turn or not) is the entire point of this skill - don't paraphrase from a hunch.

### 2. Write the copy

Fill a `GeneratedTexts` object (see `references/render-template.ts` for the exact shape) by hand:

- **`tagline`** - one punchy sentence naming the deck's actual line of play, ≤90 chars.
- **`flavor`** - a short badge line for the cover, ≤40 chars, written like real MTG flavor text (moody, in-world, often a pun on the deck's own Archidekt title or the commander's name) - never a literal label like "Deck Tech" or "Selesnya · EDH".
- **`gameplan.paragraphs`** - 2-3 paragraphs, casual-competent tone, no hype/marketing speak, no emoji. Name real cards. Structure it as: (1) the commander's core loop, (2) the supporting package that enables/scales it, (3) the finisher(s). If the user's own description called out a specific combo (e.g. "flicker Galadriel herself to reset her modes"), make sure that exact interaction is in there, corrected against the real Oracle text if needed.
- **`gameplan.steps`** - exactly 3 short imperative phrases summarizing the turn sequence.
- **`caption.body`** - 2-4 sentences for the Instagram caption, plus **`caption.hashtags`** - 8-15 tags: always include `#edh #commander #mtg #magicthegathering #deckTech`, then add deck-specific ones (color combo, archetype, commander name).

Keep every claim traceable to a card actually in the list. Don't invent synergies that aren't there.

### 3. Render

Use `references/render-template.ts` as a starting point: it fetches the deck, enriches it, generates a `nanoid()` jobId, and calls `renderDeckTech(deck, texts, jobId, sourceUrl)` from `src/pipeline.ts` - this bypasses the LLM entirely. Run with `npx ts-node scratch_render.ts`. Note the printed `jobDir`, slide count, `notFound`, and `usedFallback` arrays.

### 4. Verify

Read (view) at minimum the hero slide (`slide-01.png`), the cover slide (`slide-02.png`), and the gameplan slide before reporting success - text overflow, cropped art, and layout bugs are easy to miss without actually looking. If any code in `src/render/` was touched this session, run `npx tsc --noEmit -p tsconfig.json` first.

### 5. Clean up

Delete every `scratch_*.ts` file created for this run (`rm -f scratch_dump.ts scratch_render.ts`) before finishing. Never leave throwaway scripts in the repo. Leave the rendered `out/<jobId>/` directory in place - that's the deliverable. If a re-render superseded an earlier one in the same conversation, remove the superseded `out/<oldJobId>/` directory too.

### 6. Report

Tell the user: deck name, commander(s), slide count and `out/<jobId>/` path, then 3-5 sentences of the actual gameplan in your own words (not just repeating the caption). Flag anything worth knowing: cards in `notFound`/`usedFallback`, any Archidekt data quirks encountered, or (if relevant) that this used the manual-copy path rather than the LLM because of the missing/unfunded API key.

## Notes

- One Archidekt deck occasionally links two Partner/Background commanders - `renderDeckTech` and the hero/cover slides already handle that (both cards render side by side); just make sure the copy mentions both names correctly.
- Creature counts over 28 auto-split across two crop-grid slides - this is handled in `src/render/slideBuilder.ts` already, not something this skill needs to manage.
- `deck.maybeboard` only ever contains Archidekt's "Sideboard" category (used for the Upgrades slide) - cards filed under Archidekt's own "Maybeboard" category are intentionally dropped as private brainstorming, so don't expect an Upgrades slide unless the deck actually has a Sideboard.
