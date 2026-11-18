# Server-TODO: floating.mana Auto-Publisher

Übergabe an die Claude-Session auf dem Server (82.165.222.87, Domain `eatme.web-lh.de`,
Installation in `/opt/mtg-insta-tool`, systemd-Dienst `mtg-insta-tool`, Caddy davor).
Branch: `feat/auto-publish` (22 Commits gegenüber `main`).

## Regeln für die Server-Session

- **Keine Secrets anfassen oder ausgeben.** `IG_ACCESS_TOKEN`, `BASIC_AUTH_PASS` und
  `ANTHROPIC_API_KEY` trägt Leon selbst in die `.env` ein. Nicht danach fragen, nicht in Logs
  oder Chat ausgeben.
- **Nichts auf Instagram veröffentlichen.** Nur testen, was ohne Veröffentlichung geht.
  Veröffentlicht wird ausschließlich über die Freigabe in der App.
- **Scryfall schonen:** Keine Schleifen oder Massenabfragen. Scryfall drosselt mit HTTP 429 und
  droht mit Sperre. Ein manueller News-Abruf zum Testen reicht.
- Nach jedem Schritt kurz festhalten, was geklappt hat und was nicht.

---

## 1. Was geändert wurde (Überblick)

| Bereich | Was |
|---|---|
| Freigabe | Warteschlange `/queue.html`: Entwürfe freigeben, ablehnen, „Jetzt posten“ (zweimal tippen). Caption-Check (Feed-Vorschau bis „… mehr“), erster Kommentar, „Text säubern“ |
| Instagram | Graph API (`graph.facebook.com`, Systemnutzer-Token). Carousel, Bild, Story, Reel mit Cover. Decklisten-Link als erster Kommentar. Antworten auf Kommentare, Spam ausblenden |
| Automatik | Wochenplan pro Wochentag (Reel / Carousel / nichts + Uhrzeit), **in der App** unter Optionen. Gespeichert in `data/app-settings.json`. Standard: Mo–Sa Reel, So Carousel, 19:00, 3 Tage Vorlauf |
| Decks | Quelle Archidekt: zuerst eigene ungepostete Decks, dann Community-Decks mit Credit (Bracket ≤ 3, Budget). Bereits Gepostetes wird über die Instagram-Captions erkannt |
| Reels | Animierte 9:16-Szenen (Hook, Commander, Spielplan, Schlüsselkarten, Manakurve, Stats, Preis, Frage). Bild für Bild mit Puppeteer, kodiert mit `ffmpeg-static`. Sichere Zone für Instagram-Overlays. Stimme nur mit Piper |
| Texte | Kostenlos ohne KI: Vorlagen aus den Kartendaten. Regeln aus dem Instagram-Plugin portiert: `/ig-caption` (Linter, max. 5 Hashtags, eine Aufforderung), `/ig-human` (Floskeln raus, Karten- und Set-Namen geschützt). Aussprache-Liste in den Optionen |
| Plan | Plan-Tab: 4-Wochen-Kalender, Plan-Check nach `/ig-plan` („Übernehmen“, „In Reels umwandeln“) |
| Profil | Profil-Tab: Bewertung nach `/ig-profile` (100 Punkte), Vorschläge für Name und Bio |
| News | News-Tab: Scryfall-Spoiler (kommende Sets + Secret Lair), Commander-Bann- und Game-Changer-Änderungen. Alle 6 h automatisch (einstellbar) oder manuell. Spoiler-Carousel mit Warn-Cover. „Eigene News“ aus Kartennamen oder Scryfall-Suche. News sind **zusätzlich** zum Wochenplan |
| App | iOS-Homescreen-App: Cookie-Login statt Basic Auth, Web-Push (VAPID, kostenlos), Tab-Leiste, Hintergrund-Aufträge mit Fortschrittsanzeige |
| Neue Pakete | `web-push`, `ffmpeg-static` (Install-Skript muss laufen). `kokoro-js` wurde wieder entfernt |

---

## 2. Deployment

- [ ] `cd /opt/mtg-insta-tool && git fetch && git checkout feat/auto-publish && git pull`
- [ ] `npm ci`
- [x] Install-Skript von ffmpeg-static: steht jetzt in `package.json` unter `allowScripts` (`ffmpeg-static@5.2.0`), `npm ci` braucht keine lokale Änderung mehr
- [ ] Prüfen: `node -e "const p=require('ffmpeg-static');console.log(p, require('fs').existsSync(p))"` muss `true` ausgeben
- [ ] Puppeteer/Chromium-Bibliotheken vorhanden (`libnss3`, `libatk-bridge2.0-0`, `libgbm1`, `libasound2`, `fonts-liberation` …). Test: ein Reel erzeugen (Punkt 4)
- [ ] `npm run build` ohne Fehler. Prüfen: `ls dist/skills/lexicon/slop.json` existiert (der Build muss die JSON-Daten mitkopieren)
- [ ] `sudo systemctl restart mtg-insta-tool`
- [ ] `journalctl -u mtg-insta-tool -n 50` zeigt `[scheduler] running every 60s` und keine Fehler

## 3. `.env` prüfen (nur ob gesetzt, Werte nicht ausgeben)

Pflicht:
- [ ] `BASIC_AUTH_USER`, `BASIC_AUTH_PASS` (Login der App)
- [ ] `PUBLIC_BASE_URL=https://eatme.web-lh.de` (ohne Slash am Ende)
- [ ] `IG_USER_ID=17841441055109478`
- [ ] `IG_ACCESS_TOKEN` (Systemnutzer-Token, läuft nicht ab)
- [ ] `IG_GRAPH_HOST=graph.facebook.com`
- [ ] `TZ=Europe/Berlin` (in der `.env` oder in der systemd-Unit), sonst stimmen die Postzeiten nicht

Optional:
- [ ] `PIPER_BIN`, `PIPER_MODEL`: nur nötig für eine Stimme in Reels (siehe Punkt 6)
- [ ] `ANTHROPIC_API_KEY`: absichtlich **nicht** gesetzt (kostenlos-Modus). Nicht anlegen
- [ ] Alte Variablen `DAILY_*`, `AUTO_*` gelten nur bis zum ersten Speichern in der App und können bleiben

Prüfbefehl, der keine Werte zeigt:
```
sudo grep -oE '^[A-Z_]+=' /opt/mtg-insta-tool/.env | sort
```

## 4. Funktionstests (ohne zu veröffentlichen)

App und Login:
- [ ] `curl -sI https://eatme.web-lh.de/queue.html` liefert `302` auf `/login.html` (ohne Login)
- [ ] `curl -s -o /dev/null -w "%{http_code}" https://eatme.web-lh.de/manifest.webmanifest` liefert `200`
- [ ] `curl -s -u USER:PASS https://eatme.web-lh.de/api/settings/app` liefert JSON (Basic-Auth-Header funktioniert für curl weiterhin)

Instagram-Verbindung (nur lesen):
- [ ] `curl -s -u USER:PASS https://eatme.web-lh.de/api/profile/analysis` liefert Profil und Score, keinen Fehler

Reel erzeugen:
- [ ] In der App unter Freigabe → „Eigenen Post einplanen“ → Typ Reel → Entwurf. Oder per API:
  `POST /api/queue` mit `{"jobId":"<ein Job aus /api/jobs mit status ready>","kind":"reel","scheduledAt":"<morgen 19:00 ISO>"}`
- [ ] Auftrag in `/api/tasks` wird `done` (dauert 1–2 min)
- [ ] Datei prüfen: `ffmpeg -i out/<job>/reel.mp4` zeigt `1080x1920`, Video und Audio. Länge: ohne Stimme ~25 s; **mit Piper-Stimme ~45–55 s** bei Reel-Länge „Voll“ (jede Szene dauert so lange wie ihr gesprochener Text). Für ~25–30 s in der App Optionen → Reel-Länge „Kurz“ wählen. Bewegung prüfen: zwei Einzelbilder bei 2 s und 10 s extrahieren, sie müssen sich unterscheiden
- [ ] Danach den Test-Entwurf in der App **ablehnen**

News:
- [ ] In der App News → „Jetzt nach News suchen“. Ergebniszeile lesen. Beim ersten Mal: „Erster Abruf: N Set(s) im News-Feed“
- [ ] Im Log: `journalctl -u mtg-insta-tool | grep "\[news\]"`. Es darf **kein** `429` auftauchen
- [ ] „Eigene News“ mit `Sol Ring` → Entwurf erscheint in der Freigabe. Danach ablehnen

Automatik:
- [ ] Optionen → „Entwürfe automatisch anlegen“ ist **an** und gespeichert
- [ ] Innerhalb weniger Minuten entstehen Entwürfe für die nächsten 3 Tage (Log: `[daily] drafted …`)
- [ ] Die Entwürfe sind Reels an Reel-Tagen und Carousels am Sonntag. Pro Tag nur **ein** Deck-Post
- [ ] Bereits gepostete Decks kommen **nicht** wieder (Log: `[daily] instagram history: N posts`)

## 5. Offene Fehlerberichte von Leon prüfen

- [ ] **„Nur ein Standbild“ beim Reel:** Mit dem erzeugten Reel aus Punkt 4 prüfen, ob es sich bewegt. Ursache war vermutlich die Vorschau in der Freigabe (zeigte nur das Titelbild). Die spielt jetzt stumm automatisch ab. Falls das MP4 selbst still steht: Puppeteer-Fehler im Log suchen
- [ ] **„Kein Ton“:** Erwartet, solange Piper fehlt (stille Tonspur). Siehe Punkt 6
- [ ] **„2 Posts bei der Freigabe“:** Freigabeliste ansehen (`GET /api/queue`) und doppelte Einträge mit gleichem `label` und gleichem Tag suchen. Bekannte, inzwischen behobene Ursache: „In Reels umwandeln“ doppelt angetippt. Weitere mögliche Ursachen: Story-Entwurf (sollte aus sein, Optionen → Story), ein News-Entwurf am selben Tag (gewollt, zusätzlich), ein manuell angelegter plus ein automatischer Post. Ergebnis an Leon melden, Duplikate in der App ablehnen
- [ ] Alte Entwürfe aus früheren Versionen (alte Captions mit Link, Story-Grafiken) ablehnen, damit nur neue Formate rausgehen

## 6. Stimme für Reels (Piper) — ERLEDIGT

Piper ist installiert: `/opt/piper`, Stimmen `ryan` und `norman`, `.env` zeigt auf `norman`.
Neu und optional in der `.env`: `PIPER_SENTENCE_SILENCE` (Pause nach jedem Satz, Standard 0.25 s) und `PIPER_LENGTH_SCALE` (Tempo, Standard 1.05, größer = langsamer). Der Sprechtext wird vor Piper automatisch aufbereitet (`src/skills/ttsText.ts`: Abkürzungen, Klammern, Doppelpunkte, lange Sätze teilen).


- [x] Piper-Release für Linux x86_64 von https://github.com/rhasspy/piper/releases nach `/opt/piper` laden. **Vorher Leon fragen** (Download)
- [x] Englische Stimme, z. B. `en_US-ryan-medium.onnx` plus `.onnx.json`, nach `/opt/piper`
- [x] `.env`: `PIPER_BIN=/opt/piper/piper`, `PIPER_MODEL=/opt/piper/en_US-ryan-medium.onnx`, Neustart
- [ ] Test-Reel erzeugen. Audio-Spur hat jetzt deutlich mehr als 2 kb/s, Untertitel sind sichtbar
- [ ] Aussprache prüfen. Begriffe wie „+1/+1“ unter Optionen → Aussprache anpassen

## 7. Behoben nach dem ersten Server-Test

- ffmpeg-Abbruch (z. B. bei `systemctl restart` während eines Renders) bringt den Server nicht mehr zum Absturz: `src/render/procs.ts` fängt das ab, `process.on("unhandledRejection")` loggt statt abzustürzen, SIGTERM beendet laufende ffmpeg-Prozesse sauber
- Jobs, die beim Neustart auf `generating` hängen, werden beim Start auf `failed` („Abgebrochen durch Neustart“) gesetzt. Hintergrund-Aufträge (`/api/tasks`) liegen nur im Speicher, da bleibt nichts hängen
- `POST /api/queue` lehnt einen zweiten Deck-Post am selben Tag oder einen zweiten offenen Entwurf desselben Jobs mit 409 ab (mit `force: true` trotzdem möglich, die App fragt nach). Das Formular schlägt den nächsten freien Tag vor. News bleiben zusätzlich erlaubt
- Neustarts fragen Scryfall nicht mehr ab: der letzte News-Abruf steht in `data/news.json` (`lastPoll`), abgerufen wird erst nach Ablauf des Intervalls

Prüfen nach dem Update:
- [ ] Während eines Reel-Renders `sudo systemctl restart mtg-insta-tool`: Log zeigt `SIGTERM: fahre herunter (1 Render-Prozess(e) beendet)`, kein `status=1/FAILURE`
- [ ] Zweimal hintereinander neu starten: **kein** `[news]`-Abruf im Log
- [ ] „Eigenen Post einplanen“ für einen Tag mit Entwurf: Rückfrage erscheint

## 8. Neu: Combo-Reels (Commander Spellbook)

Erklär-Reels zu Combos im Stil „Janky Combos“: Karten einzeln, dann der Loop Schritt für Schritt, Ergebnis, Preis, Frage. Daten von der kostenlosen Commander-Spellbook-API, Kartenbilder per **einer** Scryfall-Sammelanfrage pro Combo. Ca. 30–35 s.
- Wochenplan: Tagestyp „Combo-Reel“ (Optionen → Wochenplan). Die Automatik holt dann eine beliebte, noch nicht verwendete Combo im Budget (`data/combos-posted.json`)
- Freigabe → „Eigenen Post einplanen“ → Typ „Combo-Reel (Spellbook)“, Link einfügen (leer = automatisch)
- [ ] Test: ein Combo-Reel mit `https://commanderspellbook.com/combo/4821-5261/` anlegen, Video prüfen, Entwurf danach ablehnen

## 9. Nach dem Test an Leon zurückmelden

- Was läuft, was nicht (mit Logzeilen, ohne Secrets)
- Ob Reels sich bewegen und ob Ton da ist
- Ob doppelte Entwürfe gefunden wurden und woher sie kamen
- Ob der Branch nach `main` gemergt werden soll (nur auf Leons Ansage)
