// Combo-Vorrat (src/combos/seed.json) neu von Commander Spellbook laden.
// Lokal ausfuehren (der Server wird von Spellbook mit 403 geblockt):
//   node scripts/update-combo-seed.js
// danach committen und pushen.
const fs = require("fs");
const path = require("path");

(async () => {
  const q = "cards<=3 legal:commander price<=40";
  const out = [];
  const seen = new Set();
  for (const offset of [0, 100, 200, 300, 400]) {
    const url = `https://backend.commanderspellbook.com/variants/?q=${encodeURIComponent(q)}&ordering=-popularity&limit=100&offset=${offset}`;
    const r = await fetch(url, { headers: { "User-Agent": "mtg-insta-tool/0.1", Accept: "application/json" } });
    if (!r.ok) throw new Error(`Commander Spellbook ${r.status}`);
    const j = await r.json();
    for (const v of j.results || []) {
      const names = (v.uses || []).map((u) => u.card && u.card.name).filter(Boolean);
      const key = [...names].sort().join("+");
      if (seen.has(key) || !(v.description || "").trim() || !(v.produces || []).length) continue;
      seen.add(key);
      out.push({
        id: v.id,
        uses: names.map((n) => ({ card: { name: n } })),
        produces: (v.produces || []).slice(0, 4).map((p) => ({ feature: { name: p.feature && p.feature.name } })),
        description: v.description,
        easyPrerequisites: v.easyPrerequisites || "",
        notablePrerequisites: v.notablePrerequisites || "",
        prices: { cardmarket: v.prices && v.prices.cardmarket },
        bracketTag: v.bracketTag,
        identity: v.identity,
        popularity: v.popularity,
      });
    }
    await new Promise((res) => setTimeout(res, 1500)); // API schonen
  }
  const file = path.join(__dirname, "..", "src", "combos", "seed.json");
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`${out.length} Combos -> ${file}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
