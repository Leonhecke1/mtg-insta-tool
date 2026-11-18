import { ChildProcess, spawn } from "child_process";

/**
 * Laufende ffmpeg-Prozesse. Zwei Zwecke:
 *  1. Das "fertig"-Promise hat sofort einen leeren catch-Handler. Wird ffmpeg
 *     abgebrochen, bevor jemand darauf wartet (z. B. Fehler beim Rendern oder
 *     Neustart), gibt es keine "unhandled rejection", die Node beendet.
 *  2. Beim Herunterfahren (SIGTERM) werden alle laufenden Prozesse beendet.
 */

const running = new Set<ChildProcess>();
let shuttingDown = false;

export function spawnFfmpeg(bin: string, args: string[]): { proc: ChildProcess; done: Promise<void> } {
  const proc = spawn(bin, args);
  running.add(proc);
  let stderr = "";
  // Schreiben in ein beendetes ffmpeg (EPIPE) darf den Server nicht beenden
  proc.stdin?.on("error", () => undefined);
  proc.stderr?.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
  const done = new Promise<void>((resolve, reject) => {
    proc.on("error", (err) => {
      running.delete(proc);
      reject(err);
    });
    proc.on("close", (code, signal) => {
      running.delete(proc);
      if (code === 0) return resolve();
      reject(new Error(shuttingDown ? "Abgebrochen durch Neustart" : `${bin.split(/[\\/]/).pop()} exit ${code ?? signal}:${stderr.slice(-800)}`));
    });
  });
  done.catch(() => undefined); // wird vom Aufrufer trotzdem per await ausgewertet
  return { proc, done };
}

/** Beim Herunterfahren: alle laufenden ffmpeg-Prozesse beenden */
export function killAllRenders(): number {
  shuttingDown = true;
  let n = 0;
  for (const p of running) {
    p.kill("SIGKILL");
    n++;
  }
  running.clear();
  return n;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}
