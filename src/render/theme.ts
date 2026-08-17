import { ColorCode } from "../types";

export const SLIDE_WIDTH = 1080;
export const SLIDE_HEIGHT = 1350;

export const COLORS = {
  background: "#F4EFE4",
  textPrimary: "#1F1D18",
  textSecondary: "#7A7263",
  textTertiary: "#9A8F7A",
  cardWhite: "#FFFFFF",
};

export const MANA_CIRCLE_COLORS: Record<ColorCode, string> = {
  W: "#F8E7B9",
  U: "#B6CFE8",
  B: "#A69F8D",
  R: "#EFA98B",
  G: "#C2D8CB",
};

export const COLOR_NAMES: Record<ColorCode, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

// Common color-combo names (Guild/Shard/Wedge) for the cover teaser bar.
// Keys MUST be in COLOR_ORDER (W,U,B,R,G) relative order - that's the order
// sortColorIdentity (scryfall/enrich.ts) always produces, and colorComboName
// re-canonicalizes to it below regardless of input order. Writing a wedge's
// traditional letter order here instead (e.g. Bant as "GWU") looks right but
// silently never matches, since W always sorts before G - verify any new
// entry by checking each letter appears in W,U,B,R,G order.
const COMBO_NAMES: Record<string, string> = {
  W: "Mono-White",
  U: "Mono-Blue",
  B: "Mono-Black",
  R: "Mono-Red",
  G: "Mono-Green",
  WU: "Azorius",
  UB: "Dimir",
  BR: "Rakdos",
  RG: "Gruul",
  WG: "Selesnya",
  WB: "Orzhov",
  UR: "Izzet",
  BG: "Golgari",
  WR: "Boros",
  UG: "Simic",
  WUB: "Esper",
  UBR: "Grixis",
  BRG: "Jund",
  WRG: "Naya",
  WUG: "Bant",
  WBR: "Mardu",
  URG: "Temur",
  WBG: "Abzan",
  WUR: "Jeskai",
  UBG: "Sultai",
  WUBR: "Yore-Tiller (WUBR)",
  UBRG: "Glint-Eye (UBRG)",
  WBRG: "Dune-Brood (BRGW)",
  WURG: "Ink-Treader (RGWU)",
  WUBG: "Witch-Maw (GWUB)",
  WUBRG: "Five-Color",
};

const COLOR_ORDER: ColorCode[] = ["W", "U", "B", "R", "G"];

export function colorComboName(colorIdentity: ColorCode[]): string {
  if (colorIdentity.length === 0) return "Colorless";
  const key = COLOR_ORDER.filter((c) => colorIdentity.includes(c)).join("");
  return COMBO_NAMES[key] ?? `${colorIdentity.length}-Color`;
}

export const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif';
