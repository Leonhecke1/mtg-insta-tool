/**
 * Gemeinsamer Reel-Stil fuer Deck- und Combo-Reels, nach dem /stick-figure-Skill
 * aus github.com/artemnovitckii/claude-animation-skills (MIT):
 *  - Wischuebergaenge mit horizontaler Bewegungsunschaerfe statt Ueberblenden
 *  - Handkamera-Drift + langsamer Push-in, Bild steht nie still
 *  - Aufprall = Burst (Strahlen), Wackeln, kurzer Blitz
 *  - Vignette + Filmkoernung
 *  - Untertitel: 1-2 Woerter, klein, ohne Satzzeichen, weiss mit dunkler Kontur, poppen auf
 *  - Ton: Effekte + gezupfte Untermalung aus sound.ts, Musik unter der Stimme geduckt
 *
 * Die Seite muss vor STYLE_JS definieren: TOTAL, BEATS ([{start, dur, cap, voice}]),
 * IMPACTS ([[sekunde, staerke]]). Szenen sind `.beat`-Sections in `#stage`.
 */

/** ab Start einer Einflug-Animation bis zur "Landung" (easeOutBack-Spitze) */
export const LAND = 0.32;

/** Stage-Grundtransformation: sichere Zone fuer Instagram-Overlays */
const STAGE = "translateY(122px) scale(0.85)";

export function styleCss(accent: string): string {
  return `
  #stage { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; transform-origin: 50% 0; transform: ${STAGE}; }
  .beat { position: absolute; inset: 0; opacity: 0; }
  .burst { position: absolute; left: 50%; top: 330px; width: 1400px; height: 1400px; margin-left: -700px; margin-top: -700px; border-radius: 50%; opacity: 0;
           background: repeating-conic-gradient(from 0deg, ${accent}cc 0deg 7deg, transparent 7deg 20deg);
           -webkit-mask: radial-gradient(circle, transparent 18%, #000 30%, transparent 70%); mask: radial-gradient(circle, transparent 18%, #000 30%, transparent 70%); }
  #flash { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; }
  #vig { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse 70% 60% at 50% 47%, rgba(0,0,0,0) 55%, rgba(10,5,20,.45) 100%); }
  #grain { position: absolute; inset: -256px; pointer-events: none; mix-blend-mode: overlay; opacity: .09; }
  #cap { position: absolute; left: 40px; right: 40px; top: 1255px; text-align: center; font-size: 76px; line-height: 1.1; font-weight: 900; color: #fff;
         -webkit-text-stroke: 14px #111; paint-order: stroke fill; text-shadow: 0 6px 20px rgba(0,0,0,.55); transform-origin: 50% 50%; }`;
}

/** Ueberlagerungen ausserhalb von #stage (wackeln nicht mit) */
export const STYLE_HTML = `
  <svg width="0" height="0" style="position:absolute"><filter id="hb" x="-20%" y="0" width="140%" height="100%"><feGaussianBlur id="hbd" stdDeviation="0 0"/></filter></svg>
  <div id="vig"></div><div id="grain"></div><div id="flash"></div>
  <div id="cap"></div>`;

export const STYLE_JS = `
  const capText = (s) => s.toLowerCase().replace(/[-\\u2013\\u2014]/g, " ").replace(/[^\\p{L}\\p{N}% ]/gu, "").replace(/\\s+/g, " ").trim();
  // Untertitel: hoechstens 2 Woerter / 13 Zeichen, Bruch nach Satzzeichen, ueber die Sprechdauer verteilt
  BEATS.forEach((b) => {
    const words = b.cap.split(/\\s+/).filter(Boolean), chunks = [];
    let cur = [];
    for (const w of words) {
      if (cur.length && (cur.length >= 2 || (cur.join(" ") + " " + w).length > 13)) { chunks.push(cur.join(" ")); cur = []; }
      cur.push(w);
      if (/[.,:;!?]$/.test(w)) { chunks.push(cur.join(" ")); cur = []; }
    }
    if (cur.length) chunks.push(cur.join(" "));
    const span = (b.voice || b.dur - 0.3), total = chunks.reduce((n, c) => n + c.length + 2, 0);
    let at = b.start + 0.1;
    b.chunks = chunks.map((c) => { const s = at; at += span * ((c.length + 2) / total); return { from: s, to: at, text: capText(c) }; }).filter((c) => c.text);
  });
  const easeIn = (t) => t * t * t;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeOutBack = (t) => { const c = 1.4; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const sections = [...document.querySelectorAll(".beat")];
  const capEl = document.getElementById("cap");
  const stageEl = document.getElementById("stage");
  const flashEl = document.getElementById("flash");
  const hbd = document.getElementById("hbd");
  const grainEl = document.getElementById("grain");
  const grainTiles = [0, 1, 2, 3].map((k) => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 256;
    const g = cv.getContext("2d"), id = g.createImageData(256, 256);
    let s = k * 9973 + 11;
    for (let i = 0; i < id.data.length; i += 4) { s = (s * 16807) % 2147483647; const v = 128 + ((s / 2147483647) - 0.5) * 120; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
    g.putImageData(id, 0, 0); return "url(" + cv.toDataURL() + ")";
  });
  const WT = 0.2; // halbe Wischdauer (6 Bilder)
  /** Kamera, Wischen, Aufprall, Koernung, Untertitel. Gibt die sichtbare Szene zurueck. */
  function styleFrame(t, showCaps) {
    const f = Math.round(t * 30);
    let sx = Math.sin(t * 0.9) * 6 + Math.sin(t * 2.3) * 3, sy = Math.cos(t * 0.7) * 5, rot = Math.sin(t * 0.5) * 0.35, fl = 0;
    for (const [at, k] of IMPACTS) {
      const d = t - at;
      if (d < 0 || d > 0.45) continue;
      const a = k * 28 * Math.exp(-d * 9);
      sx += Math.sin(d * 95) * a; sy += Math.cos(d * 77) * a * 0.7; rot += Math.sin(d * 60) * k * 0.8 * Math.exp(-d * 9);
      fl = Math.max(fl, k * 0.75 * Math.exp(-d * 10));
    }
    flashEl.style.opacity = String(fl);
    grainEl.style.backgroundImage = grainTiles[f % 4];
    grainEl.style.transform = "translate(" + ((f * 37) % 256) + "px," + ((f * 91) % 256) + "px)";
    let blurPx = 0, shown = null;
    sections.forEach((sec, i) => {
      const start = +sec.dataset.start, dur = +sec.dataset.dur, lt = t - start;
      const visible = lt >= 0 && (lt < dur || (i === sections.length - 1 && lt <= dur));
      sec.style.opacity = visible ? "1" : "0";
      if (!visible) { sec.style.filter = "none"; return; }
      shown = { sec, lt, dur, i };
      let dx = 0;
      if (i < sections.length - 1 && lt > dur - WT) { const p = easeIn((lt - (dur - WT)) / WT); dx = -p * 420; blurPx = p * 40; }
      if (i > 0 && lt < WT) { const p = 1 - easeOut(lt / WT); dx = p * 420; blurPx = p * 40; }
      const push = 1 + 0.035 * clamp(lt / dur);
      stageEl.style.transform = "${STAGE} translate(" + (sx + dx) + "px," + sy + "px) rotate(" + rot + "deg) scale(" + push + ")";
      sec.style.filter = blurPx > 0.5 ? "url(#hb)" : "none";
      sec.querySelectorAll(".burst").forEach((el) => {
        const d = lt - (+el.dataset.at || 0);
        el.style.opacity = d < 0 ? "0" : String(0.9 * Math.exp(-d * 2.2));
        el.style.transform = "scale(" + (0.4 + 1.4 * easeOut(clamp(d / 0.6))) + ") rotate(" + d * 25 + "deg)";
      });
    });
    hbd.setAttribute("stdDeviation", blurPx.toFixed(1) + " 0");
    const cur = BEATS.find((b) => t >= b.start && t < b.start + b.dur) || BEATS[BEATS.length - 1];
    const chunk = [...cur.chunks].reverse().find((c) => t >= c.from);
    const txt = showCaps && chunk && t < chunk.to + 0.35 ? chunk.text : "";
    if (capEl.textContent !== txt) capEl.textContent = txt;
    const k = chunk ? clamp((t - chunk.from) / 0.1) : 1;
    capEl.style.transform = "scale(" + (0.82 + 0.18 * easeOutBack(k)) + ")";
    return shown;
  }`;

/**
 * ffmpeg-Tonspur: Eingang 0 = Bilder (Pipe), 1 = sfx.wav, 2 = music.wav,
 * danach die Sprachdateien. Musik wird unter der Stimme geduckt.
 */
export function audioArgs(sfxFile: string, musicFile: string, voices: { file: string; at: number }[], total: number): string[] {
  const st = "aresample=44100,aformat=channel_layouts=stereo";
  const end = `apad,atrim=0:${total.toFixed(3)}`;
  const args = ["-i", sfxFile, "-i", musicFile];
  if (voices.length) {
    voices.forEach((v) => args.push("-i", v.file));
    const parts = voices.map((v, k) => {
      const ms = Math.round(v.at * 1000);
      return `[${k + 3}:a]${st},adelay=${ms}|${ms}[v${k}]`;
    });
    args.push(
      "-filter_complex",
      [
        ...parts,
        `${voices.map((_, k) => `[v${k}]`).join("")}amix=inputs=${voices.length}:normalize=0,${end},asplit=2[vo][key]`,
        `[2:a]${st},volume=0.22[mus]`,
        `[mus][key]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=350[mduck]`,
        `[1:a]${st},volume=0.5[fx]`,
        `[vo][mduck][fx]amix=inputs=3:normalize=0,alimiter=limit=0.95,${end}[a]`,
      ].join(";")
    );
  } else {
    args.push(
      "-filter_complex",
      [`[2:a]${st},volume=0.35[mus]`, `[1:a]${st},volume=0.55[fx]`, `[mus][fx]amix=inputs=2:normalize=0,alimiter=limit=0.95,${end}[a]`].join(";")
    );
  }
  args.push("-map", "0:v", "-map", "[a]");
  return args;
}
