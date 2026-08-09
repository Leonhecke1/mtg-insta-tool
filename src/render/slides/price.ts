import { Deck, EnrichedCard } from "../../types";
import { buildSlideHtml } from "../layoutBase";
import { escapeHtml, floatingManaCircles, formatEur } from "../components";
import { COLORS } from "../theme";

export function priceSlide(deck: Deck): string {
  const circles = floatingManaCircles(deck.colorIdentity, 6, 3);

  const top5 = [...deck.mainboard]
    .filter((c) => c.priceEur != null)
    .sort((a, b) => (b.priceEur ?? 0) - (a.priceEur ?? 0))
    .slice(0, 5);

  const rows = top5
    .map(
      (card, i) => `
      <div style="
        display:flex; align-items:center; justify-content:space-between;
        padding: 18px 0;
        ${i > 0 ? `border-top: 1px solid ${COLORS.background};` : ""}
      ">
        <div style="font-size:26px; color:${COLORS.textPrimary};">
          <span style="color:${COLORS.textTertiary}; margin-right:14px;">${i + 1}</span>
          ${escapeHtml(card.name)}
        </div>
        <div style="font-size:26px; font-weight:500; color:${COLORS.textPrimary};">${formatEur(
        card.priceEur
      )}</div>
      </div>`
    )
    .join("\n");

  const content = `
    <div style="padding: 90px 64px 0; display:flex; flex-direction:column; height:100%;">
      <div style="font-size:26px; letter-spacing:0.04em; text-transform:uppercase; color:${
        COLORS.textSecondary
      };">Cardmarket-Trend</div>
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
        display:flex; align-items:center; justify-content:space-between;
        background:${COLORS.cardWhite};
        border-radius:16px;
        padding: 22px 32px;
      ">
        <div style="font-size:24px; color:${COLORS.textSecondary};">Commander: ${escapeHtml(
    deck.commander.name
  )}</div>
        <div style="font-size:26px; font-weight:500; color:${COLORS.textPrimary};">${formatEur(
    deck.commander.priceEur
  )}</div>
      </div>
    </div>
  `;

  return buildSlideHtml(content, { circles });
}
