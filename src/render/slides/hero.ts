import { Deck } from "../../types";
import { buildSlideHtml } from "../layoutBase";
import { commanderDisplayName, escapeHtml, floatingManaCircles } from "../components";
import { COLORS } from "../theme";

const PAD_X = 40;
const PAD_TOP = 44;
const PAD_BOTTOM = 36;
const IMAGE_GAP = 20;

/**
 * Poster-artige erste Slide vor dem eigentlichen Cover (siehe cover.ts) -
 * das Commander-Artwork dominiert die Flaeche (~80%), Papier-Hintergrund +
 * Mana-Kreise bleiben als Rand sichtbar, damit es trotzdem wie "Floating
 * Mana" aussieht. Bei Partner/Background-Paaren (2 Commander) werden beide
 * Artworks nebeneinander gross gezeigt.
 *
 * Nutzt das volle Kartenbild (imageNormal, jetzt "large" 672x936 - siehe
 * scryfall/enrich.ts) statt art_crop (626x457): art_crop ist landscape und
 * musste in dieser hohen Box stark hochskaliert werden, was sichtbar
 * verpixelt aussah (siehe Nutzer-Feedback). Die Karte wird komplett gezeigt
 * (max-width/height statt einer festen Box), Radius + Schatten liegen direkt
 * auf dem <img>, nicht auf einem umgebenden weissen Kachel-Div - dadurch
 * "schwebt" nur die Karte selbst auf dem Papier-Hintergrund, kein weisses
 * Letterboxing drumherum (siehe Nutzer-Feedback).
 */
function heroImageTile(img: string | null, radius: number): string {
  const inner = img
    ? `<img src="${escapeHtml(img)}" alt="" style="
        max-width:100%; max-height:100%; width:auto; height:auto;
        object-fit:contain;
        border-radius:${radius}px;
        box-shadow: 0 24px 60px rgba(31, 29, 24, 0.22);
      " />`
    : "";
  return `
    <div style="
      flex:1;
      min-width:0;
      min-height:0;
      display:flex; align-items:center; justify-content:center;
    ">${inner}</div>`;
}

// Flex items default to min-height:auto (column) / min-width:auto (row),
// which lets a large intrinsic image size (see heroImageTile - now the
// 936px-tall "large" scan instead of the smaller art_crop) push the flex
// item past its flex-basis and grow the whole box, shoving the title below
// it out of frame. min-height:0 on every level of the chain overrides that.
function heroImageHtml(deck: Deck): string {
  if (deck.commanders.length <= 1) {
    const c = deck.commanders[0];
    return `<div style="flex:1; min-height:0; display:flex;">${heroImageTile(
      c?.imageNormal ?? c?.imageArtCrop ?? null,
      28
    )}</div>`;
  }

  // 2 commanders (Partner/Background): both cards shown whole, side by side.
  const tiles = deck.commanders
    .slice(0, 2)
    .map((c) => heroImageTile(c.imageNormal ?? c.imageArtCrop ?? null, 22))
    .join("\n");

  return `<div style="flex:1; min-height:0; display:flex; gap:16px;">${tiles}</div>`;
}

export function heroCoverSlide(deck: Deck): string {
  const circles = floatingManaCircles(deck.colorIdentity, 9, 4);
  const headline = deck.deckName || commanderDisplayName(deck.commanders);

  const content = `
    <div style="display:flex; flex-direction:column; height:100%; padding: ${PAD_TOP}px ${PAD_X}px ${PAD_BOTTOM}px;">
      ${heroImageHtml(deck)}
      <div style="margin-top:${IMAGE_GAP}px; flex-shrink:0;">
        <div style="
          font-size:20px; letter-spacing:0.05em; text-transform:uppercase;
          color:${COLORS.textSecondary};
        ">Deck Tech</div>
        <h1 style="
          margin-top:8px;
          font-size: ${headline.length > 22 ? 48 : 58}px;
          line-height:1.15;
          font-weight:500;
          color:${COLORS.textPrimary};
        ">${escapeHtml(headline)}</h1>
      </div>
    </div>
  `;

  return buildSlideHtml(content, { circles });
}
