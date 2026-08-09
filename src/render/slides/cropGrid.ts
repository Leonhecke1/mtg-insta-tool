import { ColorCode, EnrichedCard } from "../../types";
import { buildSlideHtml } from "../layoutBase";
import { colorPips, escapeHtml, floatingManaCircles, manaCostIcons } from "../components";
import { COLORS } from "../theme";

const PAD_X = 64;
const PAD_TOP = 64;
const HEADER_H = 120;
const PAD_BOTTOM = 90;
const GAP = 14;
const ART_ASPECT = 16 / 5; // width / height -> zeigt ~1/(ASPECT*cardAspect) des Scans, siehe SPEC "~25%"

function pickColumns(count: number): number {
  if (count <= 12) return 3;
  if (count <= 24) return 4;
  return 5;
}

/**
 * Crop-Grid-Slide fuer Kartenlisten (Kreaturen, Spells, Artefakte/
 * Verzauberungen). Jede Kachel zeigt den oberen Art-Ausschnitt des
 * Kartenscans (CSS-only Crop per object-fit:cover + object-position:top)
 * plus eine weisse Namenszeile mit Manakosten.
 */
export function cropGridSlide(
  title: string,
  count: number,
  cards: EnrichedCard[],
  colorIdentity: ColorCode[],
  seed: number
): string {
  const circles = floatingManaCircles(colorIdentity, seed, 3);

  const gridWidth = 1080 - PAD_X * 2;
  const gridHeight = 1350 - PAD_TOP - HEADER_H - PAD_BOTTOM;

  const cols = pickColumns(cards.length);
  const rows = Math.max(1, Math.ceil(cards.length / cols));
  const tileWidth = (gridWidth - GAP * (cols - 1)) / cols;
  const tileHeight = (gridHeight - GAP * (rows - 1)) / rows;
  const artHeight = Math.min(tileWidth / ART_ASPECT, tileHeight - 34);
  const nameFontSize = tileWidth < 190 ? 15 : tileWidth < 240 ? 17 : 19;
  const manaFontSize = tileWidth < 190 ? 13 : 15;

  const tiles = cards
    .map((card) => {
      const img = card.imageNormal;
      const artHtml = img
        ? `<img src="${escapeHtml(img)}" alt="" style="width:100%; height:${
            artHeight * 4
          }px; object-fit:cover; object-position: top;" />`
        : `<div style="width:100%; height:${artHeight}px; background:${COLORS.background};"></div>`;

      return `
      <div style="
        background:${COLORS.cardWhite};
        border-radius: 8px;
        overflow: hidden;
        display:flex; flex-direction:column;
        width:${tileWidth}px; height:${tileHeight}px;
      ">
        <div style="width:100%; height:${artHeight}px; overflow:hidden; background:${COLORS.background};">
          ${artHtml}
        </div>
        <div style="
          flex:1;
          display:flex; align-items:center; justify-content:space-between;
          padding: 0 10px;
          gap: 6px;
        ">
          <span style="
            font-size:${nameFontSize}px; font-weight:500; color:${COLORS.textPrimary};
            white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
          ">${escapeHtml(card.name)}</span>
          <span style="flex-shrink:0; font-size:${manaFontSize}px; white-space:nowrap;">${manaCostIcons(
        card.manaCost
      )}</span>
        </div>
      </div>`;
    })
    .join("\n");

  const content = `
    <div style="padding: ${PAD_TOP}px ${PAD_X}px 0;">
      <div style="display:flex; align-items:baseline; justify-content:space-between; height:${HEADER_H}px;">
        <div style="font-size:48px; font-weight:500; color:${COLORS.textPrimary};">
          ${escapeHtml(title)} <span style="color:${COLORS.textSecondary};">${count}</span>
        </div>
        <div>${colorPips(colorIdentity)}</div>
      </div>
      <div style="
        display:grid;
        grid-template-columns: repeat(${cols}, ${tileWidth}px);
        gap: ${GAP}px;
      ">
        ${tiles}
      </div>
    </div>
  `;

  return buildSlideHtml(content, { circles });
}
