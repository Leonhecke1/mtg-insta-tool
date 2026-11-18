import * as fs from "fs";
import * as path from "path";
import { config } from "../config";

/**
 * Long-lived Instagram-Tokens laufen nach 60 Tagen ab, lassen sich aber
 * verlaengern, solange sie noch gueltig und mindestens 24 h alt sind. Der
 * verlaengerte Token wird in DATA_DIR/ig-token.json gespeichert und hat dann
 * Vorrang vor IG_ACCESS_TOKEN aus der .env.
 */

interface StoredToken {
  token: string;
  refreshedAt: string;
  expiresAt: string;
  /** Welcher .env-Token als Grundlage diente - neuer .env-Token gewinnt */
  envTokenTail: string;
}

const file = () => path.join(config.dataDir, "ig-token.json");
const tail = (t: string) => t.slice(-8);

function readStored(): StoredToken | null {
  try {
    const s = JSON.parse(fs.readFileSync(file(), "utf8")) as StoredToken;
    // Wurde in der .env ein neuer Token eingetragen, gilt der.
    return s.envTokenTail === tail(config.igAccessToken) ? s : null;
  } catch {
    return null;
  }
}

export function getAccessToken(): string {
  return readStored()?.token ?? config.igAccessToken;
}

const REFRESH_EVERY_MS = 7 * 24 * 3600_000;

/** Verlaengert den Token, wenn die letzte Verlaengerung > 7 Tage her ist. */
export async function refreshTokenIfDue(): Promise<void> {
  if (!config.igAccessToken) return;
  const stored = readStored();
  if (stored && Date.now() - new Date(stored.refreshedAt).getTime() < REFRESH_EVERY_MS) return;

  const qs = new URLSearchParams({
    grant_type: "ig_refresh_token",
    access_token: getAccessToken(),
  });
  const res = await fetch(`https://graph.instagram.com/refresh_access_token?${qs}`);
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`Token refresh failed: ${body?.error?.message ?? `HTTP ${res.status}`}`);
  }

  const now = Date.now();
  const next: StoredToken = {
    token: body.access_token,
    refreshedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + Number(body.expires_in ?? 0) * 1000).toISOString(),
    envTokenTail: tail(config.igAccessToken),
  };
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(next, null, 2), { mode: 0o600 });
  console.log(`[token] refreshed, valid until ${next.expiresAt}`);
}
