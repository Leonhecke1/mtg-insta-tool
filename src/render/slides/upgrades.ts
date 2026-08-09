import { Deck, EnrichedCard, UpgradeNote } from "../../types";
import { buildSlideHtml } from "../layoutBase";
import { escapeHtml, floatingManaCircles, formatEur } from "../components";
import { COLORS } from "../theme";

const MAX_SHOWN = 5;

export function upgradesSlide(
  deck: Deck,
  upgrades: UpgradeNote[]
): string {
  const circles = floatingManaCircles(deck.colorIdentity, 7, 3);
  const cards = deck.maybeboard.slice(0, MAX_SHOWN);
  const remaining = deck.maybeboard.length - cards.length;

  const noteFor = (name: string) =>
    upgrades.find((u) => u.cardName.toLowerCase() === name.toLowerCase())?.oneLiner ?? "";

  const rowHeight = cards.length > 0 ? Math.min(210, 900 / cards.length) : 0;
  const imgWidth = rowHeight * (488 / 680);

  const rows = cards
    .map((card) => {
      const img = card.imageNormal
        ? `<img src="${escapeHtml(card.imageNormal)}" alt="" style="width:${imgWidth}px; height:${
            rowHeight - 20
          }px; object-fit:cover; border-radius:8px;" />`
        : `<div style="width:${imgWidth}px; height:${rowHeight - 20}px; background:${
            COLORS.background
          }; border-radius:8px;"></div>`;

      return `
      <div style="display:flex; gap:22px; align-items:center; padding: 10px 0;">
        ${img}
        <div style="flex:1;">
          <div style="display:flex; justify-content:space-between; align-items:baseline;">
            <div style="font-size:26px; font-weight:500; color:${COLORS.textPrimary};">${escapeHtml(
        card.name
      )}</div>
            <div style="font-size:24px; font-weight:500; color:${COLORS.textPrimary};">${formatEur(
        card.priceEur
      )}</div>
          </div>
          <div style="font-size:20px; line-height:1.4; color:${
            COLORS.textSecondary
          }; margin-top:6px;">${escapeHtml(noteFor(card.name))}</div>
        </div>
      </div>`;
    })
    .join("\n");

  const remainingNote =
    remaining > 0
      ? `<div style="font-size:20px; color:${COLORS.textTertiary}; margin-top:14px;">+ ${remaining} weitere Upgrade-Ideen</div>`
      : "";

  const content = `
    <div style="padding: 72px 64px 0; display:flex; flex-direction:column; height:100%;">
      <div style="font-size:48px; font-weight:500; color:${COLORS.textPrimary};">Upgrades</div>
      <div style="font-size:24px; color:${COLORS.textSecondary}; margin-top:6px; margin-bottom:24px;">
        Naechste Schritte, um das Deck staerker zu machen
      </div>
      <div style="
        background:${COLORS.cardWhite};
        border-radius:16px;
        padding: 12px 28px;
      ">
        ${rows}
      </div>
      ${remainingNote}
    </div>
  `;

  return buildSlideHtml(content, { circles });
}
