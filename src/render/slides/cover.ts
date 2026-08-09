import { Deck } from "../../types";
import { buildSlideHtml } from "../layoutBase";
import { escapeHtml, floatingManaCircles, formatEur } from "../components";
import { COLORS, colorComboName } from "../theme";

export function coverSlide(deck: Deck, tagline: string): string {
  const circles = floatingManaCircles(deck.colorIdentity, 1, 5);
  const combo = colorComboName(deck.colorIdentity);

  const content = `
    <div style="display:flex; flex-direction:column; height:100%; padding: 90px 72px 140px;">
      <div style="
        align-self:flex-start;
        background:${COLORS.cardWhite};
        border-radius: 999px;
        padding: 10px 22px;
        font-size: 22px;
        font-weight: 500;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: ${COLORS.textSecondary};
      ">Deck Tech &middot; EDH</div>

      <div style="flex:1; display:flex; flex-direction:column; justify-content:center;">
        <h1 style="
          font-size: 92px;
          line-height: 1.04;
          font-weight: 500;
          color:${COLORS.textPrimary};
          max-width: 880px;
        ">${escapeHtml(deck.commander.name)}</h1>
        <p style="
          margin-top: 28px;
          font-size: 34px;
          font-weight: 400;
          color:${COLORS.textSecondary};
          max-width: 760px;
          line-height: 1.4;
        ">${escapeHtml(tagline)}</p>
      </div>

      <div style="
        display:flex;
        gap: 16px;
        background: ${COLORS.cardWhite};
        border-radius: 16px;
        padding: 28px 32px;
      ">
        ${teaserStat(String(deck.cardCount), "Karten")}
        ${divider()}
        ${teaserStat(combo, "Farbidentitaet")}
        ${divider()}
        ${teaserStat(formatEur(deck.totalPriceEur), "Gesamtpreis")}
      </div>
    </div>
  `;

  return buildSlideHtml(content, { circles });
}

function teaserStat(value: string, label: string): string {
  return `
    <div style="flex:1; text-align:left;">
      <div style="font-size:30px; font-weight:500; color:${COLORS.textPrimary};">${escapeHtml(
    value
  )}</div>
      <div style="font-size:18px; color:${COLORS.textTertiary}; margin-top:4px;">${escapeHtml(
    label
  )}</div>
    </div>`;
}

function divider(): string {
  return `<div style="width:1px; background:${COLORS.background};"></div>`;
}
