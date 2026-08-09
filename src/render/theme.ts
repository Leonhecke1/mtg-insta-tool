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
  W: "Weiss",
  U: "Blau",
  B: "Schwarz",
  R: "Rot",
  G: "Gruen",
};

// Gaengige Farbkombi-Namen (Guild/Shard/Wedge) fuer die Cover-Teaser-Leiste
const COMBO_NAMES: Record<string, string> = {
  W: "Mono-Weiss",
  U: "Mono-Blau",
  B: "Mono-Schwarz",
  R: "Mono-Rot",
  G: "Mono-Gruen",
  WU: "Azorius",
  UB: "Dimir",
  BR: "Rakdos",
  RG: "Gruul",
  GW: "Selesnya",
  WB: "Orzhov",
  UR: "Izzet",
  BG: "Golgari",
  RW: "Boros",
  GU: "Simic",
  WUB: "Esper",
  UBR: "Grixis",
  BRG: "Jund",
  RGW: "Naya",
  GWU: "Bant",
  WBR: "Mardu",
  URG: "Temur",
  BGW: "Abzan",
  RWU: "Jeskai",
  GUB: "Sultai",
  WUBR: "Yore-Tiller (WUBR)",
  UBRG: "Glint-Eye (UBRG)",
  BRGW: "Dune-Brood (BRGW)",
  RGWU: "Ink-Treader (RGWU)",
  GWUB: "Witch-Maw (GWUB)",
  WUBRG: "Fuenffarbig",
};

export function colorComboName(colorIdentity: ColorCode[]): string {
  if (colorIdentity.length === 0) return "Farblos";
  const key = colorIdentity.join("");
  return COMBO_NAMES[key] ?? `${colorIdentity.length}-Farben`;
}

export const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif';
