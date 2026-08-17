import { ColorCode, Deck, EnrichedCard } from "../../types";
import { buildSlideHtml } from "../layoutBase";
import { floatingManaCircles } from "../components";
import { COLORS, COLOR_NAMES, MANA_CIRCLE_COLORS } from "../theme";
import { isLand, manaValue } from "../classify";

const CURVE_BUCKETS = ["0", "1", "2", "3", "4", "5", "6+"];

function curveCounts(cards: EnrichedCard[]): number[] {
  const counts = new Array(CURVE_BUCKETS.length).fill(0);
  for (const c of cards) {
    const bucket = Math.min(manaValue(c), CURVE_BUCKETS.length - 1);
    counts[bucket] += c.quantity;
  }
  return counts;
}

// Hybrid symbols ("{W/U}", "{2/W}") count toward every color half they
// contain - a card that can be cast with either pip does pull on both.
function pipCounts(cards: EnrichedCard[]): Record<ColorCode, number> {
  const counts: Record<ColorCode, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const c of cards) {
    const symbols = c.manaCost.match(/\{[^}]+\}/g) ?? [];
    for (const sym of symbols) {
      for (const part of sym.slice(1, -1).split("/")) {
        const code = part.toUpperCase();
        if (code in counts) counts[code as ColorCode] += c.quantity;
      }
    }
  }
  return counts;
}

export function analyticsSlide(deck: Deck): string {
  const circles = floatingManaCircles(deck.colorIdentity, 7, 3);
  const spells = [...deck.commanders, ...deck.mainboard].filter((c) => !isLand(c));

  const counts = curveCounts(spells);
  const maxCount = Math.max(...counts, 1);
  const totalMv = spells.reduce((sum, c) => sum + manaValue(c) * c.quantity, 0);
  const spellCount = spells.reduce((sum, c) => sum + c.quantity, 0);
  const avgMv = spellCount > 0 ? totalMv / spellCount : 0;

  const bars = counts
    .map((count, i) => {
      const barHeight = count === 0 ? 0 : 10 + (count / maxCount) * 150;
      return `
      <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:210px;">
        <div style="font-size:18px; color:${COLORS.textTertiary}; margin-bottom:8px;">${count}</div>
        <div style="width:100%; max-width:56px; height:${barHeight}px; background:${COLORS.textPrimary}; border-radius:6px 6px 0 0;"></div>
        <div style="font-size:18px; color:${COLORS.textSecondary}; margin-top:10px;">${CURVE_BUCKETS[i]}</div>
      </div>`;
    })
    .join("\n");

  const pips = pipCounts(spells);
  const maxPip = Math.max(...Object.values(pips), 1);
  const colorsToShow: ColorCode[] =
    deck.colorIdentity.length > 0 ? deck.colorIdentity : ["W", "U", "B", "R", "G"];
  const pipRows = colorsToShow
    .map((code, i) => {
      const count = pips[code];
      const width = count === 0 ? 0 : 6 + (count / maxPip) * 94;
      return `
      <div style="
        display:flex; align-items:center; gap:16px; padding: 12px 0;
        ${i > 0 ? `border-top: 1px solid ${COLORS.background};` : ""}
      ">
        <div style="width:110px; font-size:20px; color:${COLORS.textPrimary}; flex-shrink:0;">${
        COLOR_NAMES[code]
      }</div>
        <div style="flex:1; height:16px; background:${COLORS.background}; border-radius:8px; overflow:hidden;">
          <div style="width:${width}%; height:100%; background:${MANA_CIRCLE_COLORS[code]}; border-radius:8px;"></div>
        </div>
        <div style="width:36px; text-align:right; font-size:20px; font-weight:500; color:${
          COLORS.textPrimary
        };">${count}</div>
      </div>`;
    })
    .join("\n");

  const content = `
    <div style="padding: 90px 64px 0; display:flex; flex-direction:column; height:100%;">
      <div style="font-size:26px; letter-spacing:0.04em; text-transform:uppercase; color:${
        COLORS.textSecondary
      };">Deck Breakdown</div>
      <div style="font-size:104px; font-weight:500; color:${COLORS.textPrimary}; margin-top:10px;">
        ${avgMv.toFixed(1)}
      </div>
      <div style="font-size:22px; color:${COLORS.textTertiary}; margin-top:-6px;">Average Mana Value</div>

      <div style="margin-top:40px; background:${COLORS.cardWhite}; border-radius:16px; padding: 28px 32px 20px;">
        <div style="font-size:22px; font-weight:500; color:${COLORS.textPrimary}; margin-bottom:12px;">Mana Curve</div>
        <div style="display:flex; align-items:flex-end; gap:14px;">
          ${bars}
        </div>
      </div>

      <div style="margin-top:24px; background:${COLORS.cardWhite}; border-radius:16px; padding: 20px 32px;">
        <div style="font-size:22px; font-weight:500; color:${COLORS.textPrimary}; margin-bottom:4px;">Color Pips</div>
        ${pipRows}
      </div>
    </div>
  `;

  return buildSlideHtml(content, { circles });
}
