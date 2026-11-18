import * as fs from "fs";
import * as path from "path";
import webpush, { PushSubscription } from "web-push";
import { config } from "../config";

/**
 * Web-Push-Benachrichtigungen (kostenlos, ohne Fremddienst): VAPID-Schluessel
 * werden beim ersten Start erzeugt und in DATA_DIR gespeichert. Auf iOS ab
 * 16.4, wenn die Seite als Web-App auf dem Homescreen liegt.
 */

interface Store {
  vapid: { publicKey: string; privateKey: string };
  subscriptions: PushSubscription[];
}

const file = () => path.join(config.dataDir, "push.json");
let store: Store | null = null;

function load(): Store {
  if (store) return store;
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (fs.existsSync(file())) {
    store = JSON.parse(fs.readFileSync(file(), "utf8")) as Store;
  } else {
    store = { vapid: webpush.generateVAPIDKeys(), subscriptions: [] };
    save();
  }
  // "subject" muss eine mailto:- oder https-URL sein
  webpush.setVapidDetails(
    config.publicBaseUrl || "https://localhost",
    store.vapid.publicKey,
    store.vapid.privateKey
  );
  return store;
}

function save(): void {
  fs.writeFileSync(file(), JSON.stringify(store, null, 2), { mode: 0o600 });
}

export function vapidPublicKey(): string {
  return load().vapid.publicKey;
}

export function addSubscription(sub: PushSubscription): void {
  const s = load();
  if (!s.subscriptions.some((x) => x.endpoint === sub.endpoint)) {
    s.subscriptions.push(sub);
    save();
  }
}

export function removeSubscription(endpoint: string): void {
  const s = load();
  s.subscriptions = s.subscriptions.filter((x) => x.endpoint !== endpoint);
  save();
}

export function subscriptionCount(): number {
  return load().subscriptions.length;
}

export interface PushMessage {
  title: string;
  body: string;
  url?: string; // wohin ein Tipp auf die Benachrichtigung fuehrt
  tag?: string; // gleiche Tags ersetzen sich statt zu stapeln
}

export async function notify(msg: PushMessage): Promise<void> {
  const s = load();
  if (!s.subscriptions.length) return;
  const payload = JSON.stringify({ url: "/queue.html", ...msg });
  const dead: string[] = [];
  await Promise.all(
    s.subscriptions.map((sub) =>
      webpush.sendNotification(sub, payload, { TTL: 24 * 3600 }).catch((err) => {
        // 404/410: Abo existiert nicht mehr (App geloescht, Rechte entzogen)
        if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(sub.endpoint);
        else console.error("[push] send failed:", err?.statusCode ?? err?.message ?? err);
      })
    )
  );
  if (dead.length) {
    s.subscriptions = s.subscriptions.filter((x) => !dead.includes(x.endpoint));
    save();
  }
}
