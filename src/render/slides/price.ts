import { Deck, EnrichedCard } from "../../types";
import { buildSlideHtml } from "../layoutBase";
import { escapeHtml, floatingManaCircles, formatEur } from "../components";
import { COLORS } from "../theme";
import { isArtifactOrEnchantment, isCreature, isInstant, isLand, isSorcery } from "../classify";

interface CategoryTotal {
  label: string;
  total: number;
}

function categoryTotals(cards: EnrichedCard[]): CategoryTotal[] {
  const sum = (matches: (c: EnrichedCard) => boolean) =>
    cards.filter(matches).reduce((s, c) => s + (c.priceEur ?? 0) * c.quantity, 0);

  return [
    { label: "Creatures", total: sum(isCreature) },
    { label: "Spells", total: sum((c) => isInstant(c) || isSorcery(c)) },
    { label: "Artifacts + Enchantments", total: sum(isArtifactOrEnchantment) },
    { label: "Lands", total: sum(isLand) },
  ];
}

function todayLabel(): string {
  return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function priceSlide(deck: Deck): string {
  const circles = floatingManaCircles(deck.colorIdentity, 6, 3);

  const rows = categoryTotals(deck.mainboard)
    .map(
      (cat, i) => `
      <div style="
        display:flex; align-items:center; justify-content:space-between;
        padding: 18px 0;
        ${i > 0 ? `border-top: 1px solid ${COLORS.background};` : ""}
      ">
        <div style="font-size:26px; color:${COLORS.textPrimary};">${escapeHtml(cat.label)}</div>
        <div style="font-size:26px; font-weight:500; color:${COLORS.textPrimary};">${formatEur(
        cat.total
      )}</div>
      </div>`
    )
    .join("\n");

  const content = `
    <div style="padding: 90px 64px 0; display:flex; flex-direction:column; height:100%;">
      <div style="font-size:26px; letter-spacing:0.04em; text-transform:uppercase; color:${
        COLORS.textSecondary
      };">Cardmarket Trend</div>
      <div style="font-size:104px; font-weight:500; color:${COLORS.textPrimary}; margin-top:10px;">
        ${formatEur(deck.totalPriceEur)}
      </div>

      <div style="
        margin-top: 48px;
        background:${COLORS.cardWhite};
        border-radius:16px;
        padding: 8px 32px;
      ">
        ${rows}
      </div>

      <div style="
        margin-top: 24px;
        background:${COLORS.cardWhite};
        border-radius:16px;
        padding: 6px 32px;
      ">
        ${commanderRows(deck)}
      </div>

      <div style="margin-top: 24px; font-size:16px; line-height:1.5; color:${COLORS.textTertiary};">
        Prices are Cardmarket trend prices as of ${todayLabel()} and can change at any time.
      </div>
    </div>
  `;

  return buildSlideHtml(content, { circles });
}

function commanderRows(deck: Deck): string {
  return deck.commanders
    .map(
      (c, i) => `
      <div style="
        display:flex; align-items:center; justify-content:space-between;
        padding: 16px 0;
        ${i > 0 ? `border-top: 1px solid ${COLORS.background};` : ""}
      ">
        <div style="font-size:24px; color:${COLORS.textSecondary};">Commander: ${escapeHtml(
        c.name
      )}</div>
        <div style="font-size:26px; font-weight:500; color:${COLORS.textPrimary};">${formatEur(
        c.priceEur
      )}</div>
      </div>`
    )
    .join("\n");
}
