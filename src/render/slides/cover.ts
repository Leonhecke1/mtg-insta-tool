import { Deck } from "../../types";
import { buildSlideHtml } from "../layoutBase";
import { commanderDisplayName, escapeHtml, floatingManaCircles, formatEur } from "../components";
import { COLORS, colorComboName } from "../theme";

const IMAGE_HEIGHT = 520;
const IMAGE_WIDTH = 373; // ~ Scryfall-Kartenverhaeltnis 488/680, volle Karte sichtbar
const CARD_ASPECT_WH = 488 / 680;
const PAIR_GAP = 16;

function commanderImagesHtml(deck: Deck): string {
  // 1 Commander: eine grosse Karte. 2 (Partner/Background/Friends Forever):
  // beide nebeneinander, jeweils im vollen Kartenverhaeltnis (nicht
  // gestaucht), damit keine Karte angeschnitten wirkt.
  if (deck.commanders.length <= 1) {
    const img = deck.commanders[0]?.imageNormal;
    const inner = img
      ? `<img src="${escapeHtml(
          img
        )}" alt="" style="width:100%; height:100%; object-fit:cover; object-position:top;" />`
      : "";
    return `
      <div style="
        flex-shrink: 0;
        width:${IMAGE_WIDTH}px; height:${IMAGE_HEIGHT}px;
        background:${COLORS.cardWhite};
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 18px 40px rgba(31, 29, 24, 0.18);
      ">${inner}</div>`;
  }

  const pairWidth = (IMAGE_WIDTH - PAIR_GAP) / 2;
  const pairHeight = pairWidth / CARD_ASPECT_WH;
  const cards = deck.commanders
    .slice(0, 2)
    .map((c) => {
      const inner = c.imageNormal
        ? `<img src="${escapeHtml(
            c.imageNormal
          )}" alt="" style="width:100%; height:100%; object-fit:cover; object-position:top;" />`
        : "";
      return `
      <div style="
        width:${pairWidth}px; height:${pairHeight}px;
        background:${COLORS.cardWhite};
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 14px 32px rgba(31, 29, 24, 0.18);
      ">${inner}</div>`;
    })
    .join("\n");

  return `
    <div style="flex-shrink:0; display:flex; gap:${PAIR_GAP}px; align-items:center;">
      ${cards}
    </div>`;
}

export function coverSlide(deck: Deck, tagline: string): string {
  const circles = floatingManaCircles(deck.colorIdentity, 1, 5);
  const combo = colorComboName(deck.colorIdentity);
  const commanderName = commanderDisplayName(deck.commanders);

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

      <div style="flex:1; display:flex; align-items:center; gap: 40px;">
        <div style="flex:1; min-width:0;">
          <h1 style="
            font-size: ${deck.commanders.length > 1 ? 58 : 72}px;
            line-height: 1.1;
            font-weight: 500;
            color:${COLORS.textPrimary};
          ">${escapeHtml(commanderName)}</h1>
          <p style="
            margin-top: 24px;
            font-size: 30px;
            font-weight: 400;
            color:${COLORS.textSecondary};
            line-height: 1.4;
          ">${escapeHtml(tagline)}</p>
        </div>

        ${commanderImagesHtml(deck)}
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
