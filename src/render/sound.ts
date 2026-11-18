import * as fs from "fs";

/**
 * Soundeffekte und eine leise Begleitmusik, komplett im Code erzeugt
 * (keine Samples, keine Lizenzfragen, kostenlos). Nachgebaut nach dem
 * /stick-figure-Skill aus artemnovitckii/claude-animation-skills (MIT):
 * Whoosh bei jedem Szenenwechsel, Pop/Thud wenn etwas landet, Ticks beim
 * Zaehlen, Riser + Aufprall beim Ergebnis, gezupfte Untermalung, die unter
 * der Stimme leiser wird (das Ducking macht ffmpeg).
 */

export const SR = 44100;

export type CueKind = "whoosh" | "pop" | "thud" | "tick" | "chime" | "sparkle" | "riser" | "impact";
export interface Cue {
  at: number; // Sekunden
  kind: CueKind;
  gain?: number;
  dur?: number; // fuer riser
}

// --- Grundbausteine ---------------------------------------------------------

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(3);
const noise = (n: number) => Float32Array.from({ length: n }, () => rand() * 2 - 1);

/** RBJ-Biquad: low, high, band (f = Mitte, q aus Bandbreite) */
function biquad(x: Float32Array, type: "low" | "high" | "band", f: number, q = 0.707): Float32Array {
  const w = (2 * Math.PI * Math.min(f, SR * 0.45)) / SR;
  const cs = Math.cos(w);
  const al = Math.sin(w) / (2 * q);
  let b0: number, b1: number, b2: number;
  if (type === "low") [b0, b1, b2] = [(1 - cs) / 2, 1 - cs, (1 - cs) / 2];
  else if (type === "high") [b0, b1, b2] = [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2];
  else [b0, b1, b2] = [al, 0, -al];
  const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
const bp = (x: Float32Array, lo: number, hi: number) => biquad(x, "band", Math.sqrt(lo * hi), Math.sqrt(lo * hi) / (hi - lo));
const lp = (x: Float32Array, f: number) => biquad(x, "low", f);
const hp = (x: Float32Array, f: number) => biquad(x, "high", f);

function place(buf: Float32Array, x: Float32Array, at: number, g = 1): void {
  const i0 = Math.round(at * SR);
  for (let k = 0; k < x.length; k++) {
    const i = i0 + k;
    if (i >= 0 && i < buf.length) buf[i] += x[k] * g;
  }
}
const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const gen = (dur: number, fn: (t: number, i: number) => number) => {
  const n = Math.round(dur * SR);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = fn(i / SR, i);
  return y;
};
/** Sinus mit veraenderlicher Frequenz (Phase aufsummiert) */
function sweep(dur: number, freq: (t: number) => number, amp: (t: number) => number): Float32Array {
  let ph = 0;
  return gen(dur, (t) => {
    ph += (2 * Math.PI * freq(t)) / SR;
    return Math.sin(ph) * amp(t);
  });
}

// --- Effekte ----------------------------------------------------------------

function whoosh(dur = 0.36, up = true): Float32Array {
  const n = Math.round(dur * SR);
  const x = noise(n);
  const lo = bp(x, 250, 1200), hi = bp(x, 1500, 6000);
  return gen(dur, (t, i) => {
    const k = up ? i / n : 1 - i / n;
    const e = Math.pow(Math.sin(Math.PI * Math.min(1, t / dur)), 1.5);
    return (lo[i] * (1 - k) + hi[i] * k) * e * 1.6;
  });
}
function thud(f0 = 70, dur = 0.35, g = 1): Float32Array {
  const body = sweep(dur, (t) => f0 * (1 + 1.5 * Math.exp(-t * 30)), (t) => Math.exp(-t * 12));
  const n = lp(noise(body.length), 900);
  return body.map((v, i) => (v + n[i] * Math.exp((-i / SR) * 40) * 0.6) * g);
}
const pop = (f = 600) => sweep(0.12, (t) => f * (1 + 20 * t), (t) => Math.exp(-t * 40));
function tick(): Float32Array {
  const n = hp(noise(Math.round(0.04 * SR)), 3000);
  return n.map((v, i) => {
    const t = i / SR;
    return v * Math.exp(-t * 200) * 0.8 + Math.sin(2 * Math.PI * 2400 * t) * Math.exp(-t * 150) * 0.4;
  });
}
const chime = (f = 1760, dur = 0.8) =>
  gen(dur, (t) => (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 2.01 * t) + 0.3 * Math.sin(2 * Math.PI * f * 3 * t)) * Math.exp(-t * 6) * Math.min(1, t / 0.003) * 0.5);
function sparkle(): Float32Array {
  const out = new Float32Array(Math.round(0.7 * SR));
  [2093, 2637, 3136, 4186].forEach((f, i) => place(out, chime(f, 0.5), i * 0.05, 0.5));
  return out;
}
function riser(dur = 1.6): Float32Array {
  const n = bp(noise(Math.round(dur * SR)), 800, 5000);
  const tone = sweep(dur, (t) => 200 * Math.pow(2, (t / dur) * 2.5), () => 0.3);
  return tone.map((v, i) => {
    const k = i / tone.length;
    return (v + n[i] * 0.3 * k) * k * k;
  });
}
function impact(): Float32Array {
  const out = thud(50, 0.7, 1);
  const crack = hp(noise(Math.round(0.25 * SR)), 1800);
  place(out, crack.map((v, i) => v * Math.exp((-i / SR) * 30) * 0.5), 0);
  place(out, chime(523, 0.7), 0, 0.35);
  return out;
}

const FX: Record<CueKind, (c: Cue) => Float32Array> = {
  whoosh: () => whoosh(),
  pop: () => pop(),
  thud: () => thud(65, 0.4, 0.8),
  tick: () => tick(),
  chime: () => chime(1046, 1.1),
  sparkle: () => sparkle(),
  riser: (c) => riser(c.dur ?? 1.6),
  impact: () => impact(),
};
/** wie laut jede Sorte unter der Stimme liegt */
const FX_GAIN: Record<CueKind, number> = { whoosh: 0.35, pop: 0.4, thud: 0.5, tick: 0.3, chime: 0.35, sparkle: 0.35, riser: 0.45, impact: 0.8 };

// --- Musik: verspielte gezupfte Untermalung --------------------------------

const pluckCache = new Map<string, Float32Array>();
/** Karplus-Strong-Zupfton, bandbegrenzt wie ein Pizzicato */
function pizz(m: number, dur = 0.45): Float32Array {
  const key = `${m}|${dur}`;
  const hit = pluckCache.get(key);
  if (hit) return hit;
  const n = Math.round(dur * SR);
  const p = Math.max(2, Math.round(SR / midi(m)));
  const buf = Float32Array.from({ length: p }, () => rand() * 2 - 1);
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    raw[i] = buf[i % p];
    buf[i % p] = 0.5 * (buf[i % p] + buf[(i + 1) % p]) * 0.995;
  }
  let y = bp(raw, 180, 3500).map((v, i) => v * Math.exp((-i / SR) * 7));
  const pk = y.reduce((a, v) => Math.max(a, Math.abs(v)), 1e-9);
  y = y.map((v) => v / pk);
  pluckCache.set(key, y);
  return y;
}
const glock = (m: number, dur = 1.0) => {
  const f = midi(m);
  return gen(dur, (t) =>
    (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 6) + 0.15 * Math.sin(2 * Math.PI * f * 5.4 * t) * Math.exp(-t * 12)) *
    Math.exp(-t * 3.5) * Math.min(1, t / 0.002) * 0.5
  );
};

const BEAT = 60 / 104;
// (Grundton, Akkordtoene) als MIDI: Dm G Dm A7, danach D G A D fuer die Aufloesung
const MINOR: [number, number[]][] = [[38, [62, 65, 69]], [43, [62, 67, 71]], [38, [62, 65, 69]], [45, [61, 64, 67]]];
const MAJOR: [number, number[]][] = [[38, [62, 66, 69]], [43, [62, 67, 71]], [45, [61, 64, 69]], [38, [62, 66, 69]]];
const MOTIF: [number, number][] = [[0, 74], [0.5, 77], [1, 81], [2, 79], [2.5, 77], [3, 76]];

function playful(music: Float32Array, t0: number, t1: number, prog: [number, number[]][], g: number, glockOn: boolean): void {
  let t = t0;
  let bar = 0;
  while (t < t1 - 0.05) {
    const [root, ch] = prog[bar % 4];
    place(music, pizz(root, 0.5), t, 0.9 * g);
    place(music, pizz(root + 7, 0.5), t + 2 * BEAT, 0.7 * g);
    for (const bt of [1, 3]) for (const m of ch) if (t + bt * BEAT < t1) place(music, pizz(m - 12, 0.3), t + bt * BEAT, 0.28 * g);
    if (glockOn && bar % 2 === 0)
      for (const [bt, m] of MOTIF) {
        const mm = prog === MAJOR && m % 12 === 5 ? m + 1 : m; // F -> F# in Dur
        if (t + bt * BEAT < t1) place(music, glock(mm), t + bt * BEAT, 0.35 * g);
      }
    t += 4 * BEAT;
    bar++;
  }
}

// --- Ausgabe ------------------------------------------------------------------

function writeWav(file: string, x: Float32Array): void {
  const pk = x.reduce((a, v) => Math.max(a, Math.abs(v)), 1e-9);
  const k = 0.9 / pk;
  const data = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * k * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

/**
 * Schreibt sfx.wav (Effekte) und music.wav (Untermalung, Moll bis `resolveAt`,
 * danach Dur) mit je 0.9 Spitzenpegel. Mischen und Ducking macht ffmpeg.
 */
export function buildSoundtrack(cues: Cue[], total: number, resolveAt: number, sfxFile: string, musicFile: string): void {
  const n = Math.round((total + 0.5) * SR);
  const sfx = new Float32Array(n);
  for (const c of cues) place(sfx, FX[c.kind](c), c.at, (c.gain ?? 1) * FX_GAIN[c.kind]);
  writeWav(sfxFile, sfx);

  let music: Float32Array = new Float32Array(n);
  playful(music, 0, Math.min(resolveAt, total), MINOR, 0.8, false);
  if (resolveAt < total) {
    for (let k = 0; k < 8; k++) place(music, glock(62 + [0, 4, 7, 12, 16, 19, 24, 28][k], 0.9), Math.max(0, resolveAt - 1.6) + k * 0.2, 0.25);
    playful(music, resolveAt, total - 0.3, MAJOR, 0.9, true);
  }
  music = lp(music, 6000);
  // Ausblenden am Ende
  const fl = Math.round(0.6 * SR), end = Math.round(total * SR);
  for (let i = Math.max(0, end - fl); i < n; i++) music[i] *= Math.max(0, (end - i) / fl);
  writeWav(musicFile, music);
}
