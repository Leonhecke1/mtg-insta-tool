import { loadManaFontCss } from "./manaFont";
import { COLORS, FONT_STACK, SLIDE_HEIGHT, SLIDE_WIDTH } from "./theme";
import { CircleSpec, handleSignature, renderManaCircles } from "./components";

export interface SlideOptions {
  circles?: CircleSpec[];
  extraStyles?: string;
  bodyClass?: string;
}

/**
 * Baut ein vollstaendiges HTML-Dokument fuer einen einzelnen Slide.
 * `content` ist der innere HTML-Body der Slide (siehe src/render/slides/*).
 */
export function buildSlideHtml(content: string, opts: SlideOptions = {}): string {
  const manaFontCss = loadManaFontCss();

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  ${manaFontCss}

  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${SLIDE_WIDTH}px;
    height: ${SLIDE_HEIGHT}px;
    overflow: hidden;
    background: ${COLORS.background};
    font-family: ${FONT_STACK};
    color: ${COLORS.textPrimary};
    -webkit-font-smoothing: antialiased;
  }
  .slide {
    position: relative;
    width: ${SLIDE_WIDTH}px;
    height: ${SLIDE_HEIGHT}px;
    overflow: hidden;
  }
  .mana-circle {
    position: absolute;
    border-radius: 50%;
    z-index: 0;
    filter: blur(0.3px);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .mana-circle-symbol {
    color: rgba(31, 29, 24, 0.16);
    line-height: 1;
  }
  .handle-signature {
    position: absolute;
    bottom: 28px;
    right: 40px;
    font-size: 20px;
    font-weight: 500;
    letter-spacing: 0.02em;
    color: ${COLORS.textSecondary};
    z-index: 5;
  }
  .content {
    position: relative;
    z-index: 2;
    width: 100%;
    height: 100%;
  }
  .pip { font-size: 26px; margin-left: 4px; }
  .mana-icon { font-size: 22px; margin-right: 2px; }
  ${opts.extraStyles ?? ""}
</style>
</head>
<body class="${opts.bodyClass ?? ""}">
  <div class="slide">
    ${renderManaCircles(opts.circles ?? [])}
    <div class="content">
      ${content}
    </div>
    ${handleSignature()}
  </div>
</body>
</html>`;
}
