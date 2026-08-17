import { ColorCode, EnrichedCard } from "../types";
import { MANA_CIRCLE_COLORS, SLIDE_HEIGHT, SLIDE_WIDTH } from "./theme";

/** Zeigt 1 oder 2 (Partner/Background/Friends Forever) Commander-Namen gemeinsam an */
export function commanderDisplayName(commanders: EnrichedCard[]): string {
  return commanders.map((c) => c.name).join(" & ");
}

export interface CircleSpec {
  code: ColorCode;
  color: string;
  size: number; // px
  top: number; // % (kann <0 oder >100 sein fuer angeschnittene Kreise)
  left: number; // %
  rotate: number; // deg
  opacity: number;
}

const CIRCLE_PLACEMENT_ATTEMPTS = 80;
const CIRCLE_MIN_GAP_PX = 18; // Mindestabstand zwischen Kreisraendern

/**
 * Deterministisch-zufaellige, ueberlappungsfreie Platzierung schwebender
 * Mana-Kreise (SPEC.md Design-System "Markenzeichen"). "seed" haelt das
 * Layout pro Slide-Typ stabil, waehrend sich die Farben je nach
 * Deck-Farbidentitaet aendern. Jeder neue Kreis wird gegen alle bereits
 * platzierten geprueft (Abstand der Mittelpunkte >= Radiensumme + Gap);
 * nach CIRCLE_PLACEMENT_ATTEMPTS Versuchen wird die zuletzt geprobte
 * Position uebernommen (verhindert eine Endlosschleife bei sehr vielen
 * grossen Kreisen).
 */
export function floatingManaCircles(
  colorIdentity: ColorCode[],
  seed: number,
  count = 4
): CircleSpec[] {
  const colors = colorIdentity.length > 0 ? colorIdentity : (["W", "U", "B", "R", "G"] as ColorCode[]);
  const circles: CircleSpec[] = [];
  let s = seed;
  const rand = () => {
    // einfacher deterministischer PRNG (mulberry32), damit ein Slide-Typ
    // bei jedem Render gleich aussieht
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const placed: { cx: number; cy: number; r: number }[] = [];

  for (let i = 0; i < count; i++) {
    const code = colors[i % colors.length];
    const size = 220 + rand() * 260;
    const r = size / 2;

    let top = 0;
    let left = 0;
    for (let attempt = 0; attempt < CIRCLE_PLACEMENT_ATTEMPTS; attempt++) {
      top = -10 + rand() * 110;
      left = -10 + rand() * 110;
      const cx = (left / 100) * SLIDE_WIDTH;
      const cy = (top / 100) * SLIDE_HEIGHT;
      const collides = placed.some(
        (p) => Math.hypot(cx - p.cx, cy - p.cy) < r + p.r + CIRCLE_MIN_GAP_PX
      );
      if (!collides) break;
    }
    placed.push({ cx: (left / 100) * SLIDE_WIDTH, cy: (top / 100) * SLIDE_HEIGHT, r });

    circles.push({
      code,
      color: MANA_CIRCLE_COLORS[code],
      size,
      top,
      left,
      rotate: rand() * 30 - 15,
      opacity: 0.55 + rand() * 0.35,
    });
  }
  return circles;
}

/**
 * Schwebende Mana-Kreise mit echtem Mana-Symbol als Wasserzeichen darin
 * (SPEC.md Design-System: "echte Symbole in den Kreisen ... via Mana-Font").
 * Symbol ist tonal abgesetzt (dunklere Variante der Kreisfarbe), damit es
 * sich dezent statt plakativ einfuegt.
 */
export function renderManaCircles(circles: CircleSpec[]): string {
  return circles
    .map(
      (c) => `
    <div class="mana-circle" style="
      width:${c.size}px; height:${c.size}px;
      top:${c.top}%; left:${c.left}%;
      background:${c.color};
      transform: translate(-50%, -50%) rotate(${c.rotate}deg);
      opacity:${c.opacity};
    ">
      <i class="ms ms-${c.code.toLowerCase()} mana-circle-symbol" style="font-size:${
        c.size * 0.52
      }px;"></i>
    </div>`
    )
    .join("\n");
}

export function handleSignature(): string {
  return `<div class="handle-signature">floating.mana</div>`;
}

export function colorPips(colorIdentity: ColorCode[]): string {
  if (colorIdentity.length === 0) {
    return `<span class="ms ms-c ms-cost pip"></span>`;
  }
  return colorIdentity
    .map((c) => `<span class="ms ms-${c.toLowerCase()} ms-cost pip"></span>`)
    .join("");
}

/** Rendert Manakosten-String ("{2}{U}{U}") als mana-font Symbol-Icons */
export function manaCostIcons(manaCost: string): string {
  if (!manaCost) return "";
  const symbols = manaCost.match(/\{[^}]+\}/g) ?? [];
  return symbols
    .map((sym) => {
      const clean = sym.replace(/[{}]/g, "").toLowerCase().replace(/\//g, "");
      return `<i class="ms ms-${clean} ms-cost mana-icon"></i>`;
    })
    .join("");
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatEur(amount: number | null): string {
  if (amount == null) return "n/a";
  return amount.toLocaleString("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
