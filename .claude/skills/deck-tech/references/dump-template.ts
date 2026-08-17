// Copy to ../../../scratch_dump.ts (repo root), fill in the URL, run with:
//   npx ts-node scratch_dump.ts
// Delete the file when done - see SKILL.md step 5.

import { fetchArchidektDeck } from "./src/parser/archidekt";
import { enrichDeck } from "./src/scryfall/enrich";

const DECK_URL = "https://archidekt.com/decks/REPLACE_ME/deck-slug";

async function main() {
  const raw = await fetchArchidektDeck(DECK_URL);
  const { deck } = await enrichDeck(raw);

  console.log("=== COMMANDER ===");
  for (const c of deck.commanders) {
    console.log(`${c.name} [${c.manaCost}] ${c.typeLine}`);
    console.log(c.oracleText);
    console.log("---");
  }

  console.log("\n=== MAINBOARD (name, type, oracle) ===");
  for (const c of deck.mainboard) {
    console.log(`${c.quantity}x ${c.name} [${c.manaCost}] ${c.typeLine} | €${c.priceEur ?? "?"}`);
    if (c.oracleText) console.log("   " + c.oracleText.replace(/\n/g, " / "));
  }

  console.log("\n=== MAYBEBOARD ===");
  for (const c of deck.maybeboard) {
    console.log(`${c.quantity}x ${c.name} [${c.manaCost}] ${c.typeLine} | €${c.priceEur ?? "?"}`);
  }

  console.log("\n=== SUMMARY ===");
  console.log(
    "cardCount",
    deck.cardCount,
    "totalPriceEur",
    deck.totalPriceEur,
    "colorIdentity",
    deck.colorIdentity
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
