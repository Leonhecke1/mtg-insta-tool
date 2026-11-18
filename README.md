# mtg-insta-tool

MTG-Commander-Deckliste einfuegen &rarr; Instagram-Carousel-Post-Material
(Slides + Caption) generieren &rarr; als ZIP herunterladen.

**Kein automatischer Instagram-Upload.** Das Tool rendert die Slides und
die Caption und packt beides in eine ZIP-Datei - das Posten auf Instagram
macht man selbst (z.B. ueber die Instagram-App, ggf. mit deren eigener
Planungsfunktion). Das ist eine bewusste Abweichung von `SPEC.md`, das noch
einen automatischen Graph-API-Publish-Flow beschreibt; dieser wurde nicht
gebaut.

Siehe `SPEC.md` fuer die Design-System- und Slide-Struktur-Spezifikation.
Dieses README beschreibt Setup und Betrieb des tatsaechlich gebauten Tools.

## Setup

```bash
npm install
cp .env.example .env
# .env ausfuellen (siehe unten)
npm run build
npm start
```

Waehrend der Entwicklung: `npm run dev` (Hot-Reload via ts-node-dev).

Ohne Web-UI direkt in der Konsole testen:

```bash
npm run generate -- ./meine-deckliste.txt
npm run generate -- --moxfield https://www.moxfield.com/decks/xxxxxxxx
npm run generate -- --archidekt https://archidekt.com/decks/xxxxxxx/deck-name
npm run generate -- ./meine-deckliste.txt --llm   # mit echten Anthropic-Texten statt Platzhaltern
```

LLM-Texte (Tagline/Gameplan/Caption) sind standardmaessig AUS - ohne
`--llm` (bzw. im Web-UI ohne die Checkbox) werden Platzhaltertexte genutzt,
kein Anthropic-API-Aufruf noetig. Anthropics API wird separat vom
claude.ai/Claude-Code-Zugang abgerechnet (eigenes Guthaben noetig) - wer
das nicht will, laesst die LLM-Option einfach aus **und/oder bearbeitet die
Platzhaltertexte selbst**: im Web-UI auf die Cover- oder Gameplan-Slide
klicken (bearbeitbare Slides sind umrandet), Text anpassen, speichern -
rendert automatisch neu, ohne erneuten Scryfall/LLM-Aufruf.

## Commander, Sideboard/Maybeboard, Upgrades

- **Partner/Background/Friends-Forever-Commander** (2 Commander) werden
  unterstuetzt: bei Rohtext zwei "Commander:"-Zeilen (oder zwei
  `*CMDR*`-Markierungen), bei Moxfield/Archidekt automatisch aus
  `boards.commanders` bzw. Kategorie "Commander" (kann mehr als 1 Eintrag
  haben).
- **Upgrade-Kandidaten** kommen aus "Sideboard" ODER "Maybeboard" (beide
  Begriffe/Boards werden zusammengelegt) - Commander hat kein echtes
  Sideboard, viele Deckbuilder nutzen den Slot trotzdem fuer
  Upgrade-Wunschlisten.
- Die **Upgrades-Slide** zeigt ALLE Sideboard/Maybeboard-Karten als
  kompaktes Bild-Grid mit Preis-Badge (keine Deckelung mehr auf 5 Karten,
  dafuer kein Freitext pro Karte mehr).

Ergebnis liegt danach in `out/<jobId>/`: `slide-01.png` ... , `caption.txt`
und `deck-tech.zip` (enthaelt beides).

## .env konfigurieren

| Variable | Erforderlich fuer | Hinweis |
|---|---|---|
| `PORT` | Server | Default 3000 |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | Web-UI-Schutz | **Unbedingt setzen**, sobald der Server oeffentlich erreichbar ist |
| `ANTHROPIC_API_KEY` | Gameplan-/Upgrade-/Caption-Texte | Ohne Key: automatischer Fallback auf Platzhaltertexte |

Scryfall, Moxfield und Archidekt brauchen keine Keys.

## Benutzung (Web-UI)

1. Server starten, `http://<server>:3000` oeffnen (Basic-Auth-Login).
2. Deckliste als Rohtext einfuegen, oder Moxfield-/Archidekt-URL angeben.
3. **LLM-Texte generieren** an/aus (aus = schneller Preview ohne
   Anthropic-Kosten, nutzt Platzhaltertexte).
4. "Generieren" klicken. Nach kurzer Zeit (Puppeteer + Scryfall + ggf. LLM
   brauchen ein paar Sekunden) erscheinen die Slides als Vorschau, plus
   Links zu `caption.txt` und zum "ZIP herunterladen"-Button.
5. ZIP herunterladen, Bilder + Caption manuell auf Instagram posten.

Die Job-Historie (Status, Deck-Zusammenfassung, Links) liegt persistent in
`data/jobs.json` (lowdb/JSON) - ueberlebt Server-Neustarts. Es gibt kein
Scheduling/Zeitplanung mehr - jede Generierung laeuft sofort beim Klick auf
"Generieren".

## Deployment auf einem Server

Kein Cron/Scheduler mehr noetig - der Server kann auch kurzlebig laufen
(z.B. nur waehrend man ihn nutzt). Fuer Dauerbetrieb trotzdem empfehlenswert:
[pm2](https://pm2.keymetrics.io/) oder systemd.

```bash
npm run build
pm2 start dist/server.js --name mtg-insta-tool
pm2 save
```

Puppeteer braucht auf einem frischen Linux-Server ggf. zusaetzliche
Chromium-Abhaengigkeiten (`libnss3`, `libatk-bridge2.0-0`, etc.) - siehe
[Puppeteer Troubleshooting](https://pptr.dev/troubleshooting).

Server unbedingt hinter Basic-Auth (`.env`) oder einen eigenen
Reverse-Proxy mit Auth stellen, bevor er oeffentlich erreichbar ist.

## Architektur-Kurzueberblick

```
src/
  parser/        Rohtext-, Moxfield- und Archidekt-Parser -> RawDeckList
  scryfall/       Batch-Anreicherung (+ Einzelabfrage-Fallback) -> Deck
  llm/            Anthropic-Textgenerierung (+ Fallback ohne LLM)
  render/         HTML/CSS-Templates pro Slide + Puppeteer-Renderer
  output/         ZIP-Packaging (Slides + caption.txt -> deck-tech.zip)
  jobs/           Job-Persistenz (lowdb) fuer die Web-UI-Historie
  pipeline.ts     Orchestriert Parser -> Scryfall -> Render -> Texte -> ZIP
  server.ts       Express-Server + REST-API fuer das Web-UI
  cli.ts          Lokales Testen ohne Server
public/           Statisches Web-UI (Vanilla HTML/CSS/JS, kein Build-Step)
```

## Scryfall-Nutzung

Scryfall ist die einzige Kartendatenquelle im Tool - nicht nur fuer Preise:
Kartenbild (`image_uris.normal`, fuer Crop-Grid-Kacheln und die
Vollformat-Upgrade-Slide), Manakosten, Type-Line, Oracle-Text (fuer die
Kreaturen/Spells/Artefakte-Einteilung und als LLM-Kontext),
Farbidentitaet (Deck-Farbidentitaet + Mana-Kreis-Farben) und der
Cardmarket-EUR-Preis kommen alle von dort. Cardmarkets eigene API ist fuer
neue Entwickler praktisch nicht zugaenglich, andere Quellen (MTGJSON,
TCGplayer) liefern keine verlaesslichen EUR/Cardmarket-Preise - Scryfall
bleibt die einzig praktikable Quelle.

Der Batch-Endpoint (`POST /cards/collection`) hat in der Praxis
gelegentlich 503/429/Wartungsfenster-Aussetzer gezeigt. `src/scryfall/client.ts`
retried automatisch (inkl. 429) und weicht bei dauerhaftem Ausfall auf
einzelne `GET /cards/named`-Abfragen pro Karte aus (langsamer, aber
robuster).

**Fallback bei Moxfield-/Archidekt-Import:** Beide Plattformen liefern in
ihrer Deck-JSON bereits fast alles, was sonst von Scryfall kommt - Moxfield
spiegelt Scryfalls Schema fast 1:1 (inkl. `prices.eur`), Archidekt liefert
Cardmarket-Preis (`prices.cm`), Oracle-Text/Typen/Farbidentitaet sowie eine
Scryfall-Card-UUID, aus der sich die Bild-URL direkt auf
`cards.scryfall.io` (separate, statische Asset-Infrastruktur - blieb in der
Praxis auch waehrend eines Scryfall-API-Wartungsfensters erreichbar) ohne
API-Aufruf konstruieren laesst. Wenn Scryfall eine Karte nicht liefern kann
(einzeln nicht gefunden oder API komplett down), nutzt `scryfall/enrich.ts`
automatisch diese mitgelieferten Daten als Fallback. Bei Rohtext-Importen
gibt es keinen Fallback - dort ist Scryfall zwingend erforderlich, da es
die einzige Datenquelle ist.

## Bekannte Einschraenkungen / offene Punkte

- Moxfield- und Archidekt-API-Antwortformate sind gegen Stand der
  Implementierung geprueft (inkl. echtem Live-Response), aber beide APIs
  sind nicht offiziell stabil versioniert - bei Fehlern zuerst hier
  ansetzen (`src/parser/moxfield.ts`, `src/parser/archidekt.ts`).
- Slide-Design ist funktional nach SPEC.md umgesetzt, aber nicht
  pixelgenau gegen ein Figma-Mockup abgeglichen - bei Bedarf CSS in
  `src/render/slides/*.ts` und `src/render/theme.ts` anpassen.
- Kein automatischer Instagram-Publish (siehe oben) - `SPEC.md`s
  "Instagram-Publishing"-Abschnitt beschreibt einen Graph-API-Flow, der
  bewusst nicht Teil dieses Tools ist.

## Auto-Publishing mit Freigabe

Freigabe-Seite: `/queue.html`. Nur freigegebene Einträge werden veröffentlicht.
Der Scheduler läuft im Server-Prozess. Er postet freigegebene Carousels,
Bilder, Stories und Reels zur geplanten Zeit und legt alle 15 min
Antwort-Entwürfe auf neue Kommentare unter eigenen Posts an.

`.env`:

```
IG_USER_ID=...            # Instagram-Professional-Account-ID
IG_ACCESS_TOKEN=...       # Systemnutzer-Token aus "API setup with Unified login" (läuft nie ab)
IG_GRAPH_HOST=graph.facebook.com   # graph.instagram.com nur für Instagram-Login-Tokens (60 Tage, Auto-Refresh)
IG_API_VERSION=v23.0      # gegen aktuelle Meta-Doku prüfen
PUBLIC_BASE_URL=https://dein-server.de   # öffentlich erreichbar, Instagram lädt /media/<token>/<n>.jpg
SCHEDULER_INTERVAL_SEC=60
COMMENT_POLL_MINUTES=15
```

Ohne diese Variablen ist Auto-Publishing deaktiviert. Die Seite funktioniert trotzdem,
es wird nur nichts gepostet.

### Reels

In `/queue.html` als Typ „Reel“ wählen und einen Hook eingeben. Das Tool rendert
ein 9:16-Reel (1080×1920, ca. 16 s): Commander-Karte auf geblurrtem Artwork mit
dem Hook als Textbox, danach Slides 2–6 mit langsamem Zoom. ffmpeg kommt aus
`ffmpeg-static`. Auf dem Server muss dessen Install-Skript einmal laufen dürfen
(`npm approve-scripts ffmpeg-static`), sonst fehlt die Binary. Die Tonspur ist
still, weil die API keine Trend-Audio setzen kann.

### Token-Verlängerung

Der Scheduler verlängert den Long-lived-Token automatisch alle 7 Tage und speichert
ihn in `DATA_DIR/ig-token.json`. Wird in der `.env` ein neuer `IG_ACCESS_TOKEN`
eingetragen, hat dieser Vorrang.

### Täglicher Deck-Post

Mit `DAILY_DECKS=true` legt der Server für die nächsten Tage je einen Carousel-Entwurf
(plus Story) in `/queue.html` an. Ein abgelehnter Entwurf wird beim nächsten Lauf
durch ein anderes Deck ersetzt.

Quelle ist Archidekt: zuerst eigene, noch nicht gepostete Decks, dann beliebte
Community-Decks (Bracket ≤ 3 oder ohne Angabe, kein cEDH-Tag, unter Budget,
Commander noch nie gepostet). Fremde Decks bekommen immer einen Credit an den
Ersteller in der Caption. Moxfield wird nicht automatisch abgefragt.

```
DAILY_DECKS=true
DAILY_POST_HOUR=19          # Serverzeit; ggf. TZ=Europe/Berlin setzen
DAILY_LOOKAHEAD_DAYS=3
DAILY_BUDGET_MAX_EUR=250
DAILY_STORY=true
ARCHIDEKT_OWN_USERNAME=floating.mana
```

Mit `ANTHROPIC_API_KEY` schreibt das LLM Tagline, Gameplan und Caption, ohne Key gibt es nur Platzhaltertexte.
