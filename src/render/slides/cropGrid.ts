import { ColorCode, EnrichedCard } from "../../types";
import { buildSlideHtml } from "../layoutBase";
import { colorPips, escapeHtml, floatingManaCircles } from "../components";
import { COLORS } from "../theme";

const PAD_X = 64;
const PAD_TOP = 64;
const HEADER_H = 120;
const PAD_BOTTOM = 90;
const GAP = 6;
const MAX_COLS = 7;
// Scryfall "normal" Scan ist 488x680px -> Breite/Hoehe des Kartenbilds
const CARD_ASPECT_WH = 488 / 680;
// Ziel-Seitenverhaeltnis (Breite/Hoehe) der Kachel, damit der Ausschnitt
// mindestens ca. am oberen Rand der Textbox endet (Name + Art + Type-Line,
// keine Regeltext-Zeilen) - siehe modernes Kartenrahmen-Layout. Ist mehr
// Platz da (wenige Karten), wird groesser gezeigt, bis hoechstens die
// komplette Karte (CARD_ASPECT_WH) - so bleibt die verfuegbare Flaeche
// immer ausgenutzt, statt leeren Raum unter dem Grid zu lassen.
const MIN_TILE_ASPECT = 1.16;

function pickColumns(count: number): number {
  if (count <= 12) return 3;
  if (count <= 24) return 4;
  return 5;
}

/**
 * Crop-Grid-Slide fuer Kartenlisten (Kreaturen, Spells, Artefakte/
 * Verzauberungen, Laender). Jede Kachel ist ein oben angeschnittener
 * Ausschnitt des Kartenscans (CSS-only Crop per object-fit:cover +
 * object-position:top) - der Kartenname steht bereits im Scan selbst,
 * daher keine zusaetzliche Namens-/Manakosten-Zeile. Karten mit
 * quantity > 1 (z.B. Basic Lands) bekommen ein "Nx"-Badge oben links statt
 * N identischer Kacheln. Bei sehr vielen Karten wird ueber mehr Spalten
 * (bis MAX_COLS) und als letzter Ausweg per Hoehen-Stauchung sichergestellt,
 * dass alles auf dem 1350px-Slide Platz findet; bei wenigen Karten wachsen
 * die Kacheln stattdessen bis zur vollen Karte, um die Flaeche auszunutzen.
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

  let cols = pickColumns(cards.length);
  let rows = Math.max(1, Math.ceil(cards.length / cols));
  let tileWidth = (gridWidth - GAP * (cols - 1)) / cols;
  let minTileHeight = tileWidth / MIN_TILE_ASPECT;
  let fullCardHeight = tileWidth / CARD_ASPECT_WH;
  let availablePerRow = (gridHeight - GAP * (rows - 1)) / rows;

  while (availablePerRow < minTileHeight && cols < MAX_COLS) {
    cols += 1;
    rows = Math.max(1, Math.ceil(cards.length / cols));
    tileWidth = (gridWidth - GAP * (cols - 1)) / cols;
    minTileHeight = tileWidth / MIN_TILE_ASPECT;
    fullCardHeight = tileWidth / CARD_ASPECT_WH;
    availablePerRow = (gridHeight - GAP * (rows - 1)) / rows;
  }

  // Genug Platz -> bis zur vollen Karte wachsen (nie darueber, sonst
  // wuerde object-fit:cover den Rand der Karte anschneiden statt oben zu
  // croppen). Zu wenig Platz trotz MAX_COLS -> letzter Ausweg, gleichmaessig
  // unter den Mindest-Crop stauchen, damit garantiert alles passt.
  const tileHeight =
    availablePerRow < minTileHeight ? availablePerRow : Math.min(availablePerRow, fullCardHeight);

  const nameFontSize = tileWidth < 190 ? 14 : 16;

  const tiles = cards
    .map((card) => {
      const img = card.imageNormal;
      const artHtml = img
        ? `<img src="${escapeHtml(
            img
          )}" alt="" style="width:100%; height:100%; object-fit:cover; object-position: top;" />`
        : `<div style="width:100%; height:100%; background:${COLORS.background};"></div>`;

      const badge =
        card.quantity > 1
          ? `<div style="
              position:absolute; top:8px; left:8px;
              background:${COLORS.textPrimary};
              color:#fff;
              font-size:${nameFontSize}px;
              font-weight:500;
              padding: 2px 8px;
              border-radius: 999px;
              line-height:1.4;
            ">${card.quantity}x</div>`
          : "";

      return `
      <div style="
        position:relative;
        background:${COLORS.cardWhite};
        border-radius: 8px;
        overflow: hidden;
        width:${tileWidth}px; height:${tileHeight}px;
      ">
        ${artHtml}
        ${badge}
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
