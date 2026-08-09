import { ColorCode } from "../types";
import { MANA_CIRCLE_COLORS } from "./theme";

export interface CircleSpec {
  color: string;
  size: number; // px
  top: number; // % (kann <0 oder >100 sein fuer angeschnittene Kreise)
  left: number; // %
  rotate: number; // deg
  opacity: number;
}

/**
 * Deterministisch-zufaellige Platzierung schwebender Mana-Kreise
 * (SPEC.md Design-System "Markenzeichen"). "seed" haelt das Layout pro
 * Slide-Typ stabil, waehrend sich die Farben je nach Deck-Farbidentitaet
 * aendern.
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

  for (let i = 0; i < count; i++) {
    const color = colors[i % colors.length];
    circles.push({
      color: MANA_CIRCLE_COLORS[color],
      size: 220 + rand() * 260,
      top: -10 + rand() * 110,
      left: -10 + rand() * 110,
      rotate: rand() * 30 - 15,
      opacity: 0.55 + rand() * 0.35,
    });
  }
  return circles;
}

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
    "></div>`
    )
    .join("\n");
}

export function handleSignature(): string {
  return `<div class="handle-signature">floating_mana</div>`;
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
  return amount.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
