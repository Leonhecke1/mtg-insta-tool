import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { NextFunction, Request, Response } from "express";
import { config } from "./config";

/**
 * Login per Formular + langlebigem Cookie statt HTTP Basic Auth. Basic Auth
 * funktioniert in iOS-Homescreen-Web-Apps unzuverlaessig (kein Prompt,
 * Zugangsdaten werden nicht gemerkt) und blockiert Service Worker/Push.
 * Zugangsdaten bleiben BASIC_AUTH_USER / BASIC_AUTH_PASS aus der .env.
 * Ein Basic-Auth-Header wird weiterhin akzeptiert (z. B. fuer curl).
 */

const COOKIE = "mtg_session";
const MAX_AGE_S = 365 * 24 * 3600;

export const authEnabled = () => Boolean(config.basicAuthUser && config.basicAuthPass);

let secret: Buffer | null = null;
function getSecret(): Buffer {
  if (secret) return secret;
  const file = path.join(config.dataDir, "session-secret");
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  secret = Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
  return secret;
}

// Passwortwechsel in der .env macht alte Cookies automatisch ungueltig
function expectedToken(): string {
  return crypto
    .createHmac("sha256", getSecret())
    .update(`${config.basicAuthUser}:${config.basicAuthPass}`)
    .digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function isAuthenticated(req: Request): boolean {
  if (!authEnabled()) return true;
  const cookie = readCookie(req, COOKIE);
  if (cookie && safeEqual(cookie, expectedToken())) return true;
  const header = req.headers.authorization ?? "";
  const basic = "Basic " + Buffer.from(`${config.basicAuthUser}:${config.basicAuthPass}`).toString("base64");
  return safeEqual(header, basic);
}

/** Pfade, die ohne Login erreichbar sein muessen */
const PUBLIC = [
  /^\/login(\.html)?$/,
  /^\/api\/login$/,
  /^\/manifest\.webmanifest$/,
  /^\/icons\//,
  /^\/media\//,
  /^\/style\.css$/,
];

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isAuthenticated(req) || PUBLIC.some((re) => re.test(req.path))) return next();
  if (req.path.startsWith("/api/")) {
    res.status(401).json({ error: "login required" });
    return;
  }
  res.redirect(302, `/login.html?next=${encodeURIComponent(req.originalUrl)}`);
}

// Einfache Bremse gegen Passwort-Raten
const attempts = new Map<string, { n: number; until: number }>();

export function handleLogin(req: Request, res: Response): void {
  const ip = req.ip ?? "?";
  const a = attempts.get(ip);
  if (a && a.until > Date.now()) {
    res.status(429).json({ error: "Zu viele Versuche, bitte kurz warten" });
    return;
  }
  const { user, pass } = req.body ?? {};
  const ok =
    authEnabled() &&
    typeof user === "string" &&
    typeof pass === "string" &&
    safeEqual(user, config.basicAuthUser) &&
    safeEqual(pass, config.basicAuthPass);
  if (!ok) {
    const n = (a?.n ?? 0) + 1;
    attempts.set(ip, { n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 });
    res.status(401).json({ error: "Benutzer oder Passwort falsch" });
    return;
  }
  attempts.delete(ip);
  const secure = req.secure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${expectedToken()}; Path=/; Max-Age=${MAX_AGE_S}; HttpOnly; SameSite=Lax${secure}`
  );
  res.json({ ok: true });
}

export function handleLogout(_req: Request, res: Response): void {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  res.json({ ok: true });
}
