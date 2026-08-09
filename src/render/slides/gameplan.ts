import { Deck, GameplanText } from "../../types";
import { buildSlideHtml } from "../layoutBase";
import { escapeHtml, floatingManaCircles } from "../components";
import { COLORS } from "../theme";

export function gameplanSlide(deck: Deck, gameplan: GameplanText): string {
  const circles = floatingManaCircles(deck.colorIdentity, 5, 3);

  const paragraphs = gameplan.paragraphs
    .map(
      (p) =>
        `<p style="font-size:27px; line-height:1.5; color:${COLORS.textPrimary}; margin-bottom:20px;">${escapeHtml(
          p
        )}</p>`
    )
    .join("\n");

  const stepLabels = ["01", "02", "03"];
  const steps = gameplan.steps
    .map(
      (step, i) => `
      <div style="flex:1;">
        <div style="font-size:22px; font-weight:500; color:${COLORS.textTertiary};">${stepLabels[i]}</div>
        <div style="font-size:20px; line-height:1.4; color:${COLORS.textPrimary}; margin-top:6px;">${escapeHtml(
        step
      )}</div>
      </div>`
    )
    .join("\n");

  const content = `
    <div style="padding: 72px 64px 0; display:flex; flex-direction:column; height:100%;">
      <div style="font-size:48px; font-weight:500; color:${COLORS.textPrimary}; margin-bottom:36px;">
        Gameplan
      </div>
      <div style="max-width: 900px;">
        ${paragraphs}
      </div>
      <div style="flex:1;"></div>
      <div style="
        display:flex; gap: 28px;
        background:${COLORS.cardWhite};
        border-radius:16px;
        padding: 30px 32px;
        margin-bottom: 90px;
      ">
        ${steps}
      </div>
    </div>
  `;

  return buildSlideHtml(content, { circles });
}
