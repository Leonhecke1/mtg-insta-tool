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

### Automatische Interaktion

```
AUTO_REPLY=true            # Antworten auf Kommentare (< 48 h alt) automatisch freigeben
AUTO_REPLY_DELAY_MIN=10    # Wartezeit, in der man in /queue.html noch ablehnen/ändern kann
AUTO_HIDE_SPAM=true        # vom LLM als Spam/Bot erkannte Kommentare ausblenden
```

Benötigt `ANTHROPIC_API_KEY`. Kommentare, die älter als 7 Tage sind, werden ignoriert.
Liken, Kommentieren und Folgen bei fremden Accounts wird bewusst nicht automatisiert,
weil die API das nicht anbietet und Bots dafür gesperrt werden.

Die tägliche Story ist eine „NEW POST“-Grafik mit dem Cover. Beiträge teilen und
Link-Sticker kann die API nicht.

## Komplett ohne Kosten

Ohne `ANTHROPIC_API_KEY` läuft alles kostenlos:

- **Texte:** Vorlagen aus den Kartendaten (`src/llm/fallback.ts`). Sie erkennen Archetyp,
  Tribal, Schlüsselkarten, Ramp/Draw/Removal und die Commander-Fähigkeit.
- **Spam:** Regeln in `src/queue/spam.ts`, z. B. „send me this post“ oder „promote it on @“.
  Treffer werden ausgeblendet. Antwortentwürfe gibt es ohne Key nicht.
- **Voice-over für Reels:** [Piper](https://github.com/rhasspy/piper) lokal auf dem Server.

```
PIPER_BIN=/opt/piper/piper
PIPER_MODEL=/opt/piper/en_US-ryan-medium.onnx   # Voice: .onnx + .onnx.json im selben Ordner
```

Ohne Piper bleiben Reels stumm.

Natürlichere Stimme: [Nari Labs Dia](https://github.com/nari-labs/dia) mit `TTS_ENGINE=dia`
(Python-venv, ~8 GB RAM, auf CPU langsam). `scripts/dia_tts.py` spricht alle Szenen eines Reels
mit derselben Stimme (`DIA_VOICE_PROMPT`). Schlägt Dia fehl, springt Piper ein. Setup: SERVER_TODO.md, Abschnitt 8b.

## Handy-App (iOS) und Benachrichtigungen

- **Login:** Formular mit dauerhaftem Cookie statt Basic Auth. Basic Auth geht in iOS-Homescreen-Apps
  nicht zuverlässig. Zugangsdaten bleiben `BASIC_AUTH_USER` / `BASIC_AUTH_PASS`. Für curl wird ein
  Basic-Auth-Header weiterhin akzeptiert. Nach 5 Fehlversuchen ist die IP 5 Minuten gesperrt.
- **Installieren:** In Safari `https://<domain>/queue.html` öffnen → Teilen → „Zum Home-Bildschirm“.
- **Benachrichtigungen:** In der App unter Einstellungen → „Benachrichtigungen aktivieren“
  (ab iOS 16.4, nur aus der Homescreen-App). Web Push mit eigenen VAPID-Schlüsseln
  (`DATA_DIR/push.json`), kostenlos und ohne Fremddienst. Du bekommst eine Benachrichtigung bei:
  - neuen Deck-Entwürfen
  - einem Post, der in < 3 h fällig und noch nicht freigegeben ist
  - neuen Kommentaren (nur mit LLM)
  - fehlgeschlagenem Veröffentlichen
- **Navigation:** Tab-Leiste unten (Freigabe / Erstellen / Einstellungen) mit Zähler offener Entwürfe.

## Reels, Plan und „Jetzt posten“

- **Reels** sind eigene animierte 9:16-Videos (ca. 16 s), keine Slide-Zooms. Sie bestehen aus
  sechs Szenen: Hook mit Artwork, Commander-Reveal mit Fähigkeit, Schlüsselkarten, Ramp/Draw/Removal,
  Preis und Call to Action. Gerendert wird Bild für Bild mit Puppeteer, kodiert mit ffmpeg.
  Mit Piper bekommt jede Szene ihre eigene Sprachspur, ihre Länge richtet sich nach dem Satz,
  und Untertitel laufen mit. Ein Titelbild wird als Vorschau und Instagram-Cover gespeichert.
- **Reel-Tage:** `DAILY_REEL_DAYS=di,fr`. An diesen Tagen legt der Automatismus ein Reel statt
  eines Carousels an.
- **Plan-Tab:** Kalender für 4 Wochen plus Tagesliste. Zeigt die Einstellungen des Automatismus.
  „Deck holen“ füllt einen leeren Tag. Neu laden jede Minute.
- **Jetzt posten:** In der Freigabe zweimal tippen. Der Eintrag wird freigegeben und sofort
  veröffentlicht.

### Hintergrund-Aufträge

„Neues Deck“, „Deck holen“ im Plan und „Eigenen Post einplanen“ (vor allem Reels) laufen als
Hintergrund-Auftrag. Die Anfrage kommt sofort zurück (HTTP 202 mit `taskId`). Über der Tab-Leiste
zeigt jede Seite Schritt und Fortschrittsbalken (`GET /api/tasks`). Seitenwechsel oder das Schließen
der App brechen nichts ab. Fertige und fehlgeschlagene Aufträge melden sich zusätzlich per Push.

## Regeln aus dem Instagram-Plugin (kostenlos, ohne Claude)

Übernommen aus [instagram-agent-skill](https://github.com/Jakeschincariol/instagram-agent-skill)
(MIT, © Jake Schincariol). Lizenz in `src/skills/lexicon/LICENSE-instagram-agent-skill`.

- **/ig-caption** (`src/skills/igCaption.ts`, `src/skills/caption.ts`): Captions mit Hook in den
  ersten 125 Zeichen, kurzen Absätzen mit Suchbegriffen, genau einer Aufforderung und höchstens
  5 Hashtags. Der Archidekt-Link steht nicht in der Caption, er wird nach dem Veröffentlichen als
  erster Kommentar gepostet. Die Freigabe zeigt die Feed-Vorschau und das Linter-Ergebnis live.
- **/ig-human** (`src/skills/human.ts`, Daten `slop.json`): entfernt unsichtbare Zeichen,
  Gedankenstriche und KI-Floskeln und meldet typische KI-Satzmuster. Kartennamen und MTG-Begriffe
  (z. B. „synergy“, „unleash“) bleiben geschützt. Automatisch auf jede neue Caption angewendet,
  manuell über „Text säubern“.
- **/ig-profile** (`src/skills/profile.ts`, Daten `rubric.json`): Tab „Profil“ bewertet das Profil
  mit 100 Punkten. Name-Feld, Bio, Link, Handle, Aktivität und Stories werden automatisch über die
  API bewertet. Angepinnte Posts, Highlights, Grid, Profilbild und Kategorie schätzt du einmal selbst
  ein, weil die API diese Felder nicht liefert. Dazu gibt es Vorschläge zum Kopieren und
  Kandidaten zum Anpinnen.

Reels halten Instagrams sichere Zone ein (oben ~210 px, unten ~480 px, rechts die Buttons frei).

## Einstellungen in der App

Unter **Einstellungen → Automatik & Wochenplan**: Für jeden Wochentag Reel, Carousel oder nichts samt
Uhrzeit, Vorlauf in Tagen, Budget, eigener Archidekt-Name, Story-Grafik an/aus, Reel-Länge,
Spam-Filter und Auto-Antworten. Gespeichert in `DATA_DIR/app-settings.json` und sofort wirksam.
Die `DAILY_*`-Werte aus der `.env` gelten nur bis zum ersten Speichern.

**Plan-Check (/ig-plan)** im Plan-Tab: bewertet den Wochenplan (mindestens 3 Reels pro Woche,
Frequenz, Postzeiten, eigene Zahlen Reel gegen Carousel). „Übernehmen“ setzt die Empfehlung um
(Reel-Fokus: Mo–Sa Reel, So Carousel), „In Reels umwandeln“ baut Carousel-Entwürfe an Reel-Tagen um.

## News

Tab **News**: offizielle MTG-News von Scryfall, alle 6 Stunden abgerufen (einstellbar unter
Optionen → News) oder per „Jetzt nach News suchen“.

- **Spoiler:** Neue Karten aus kommenden oder gerade erschienenen Sets und aus Secret Lair Drops
  der letzten 30 Tage. Ab 3 neuen Karten eines Sets (einstellbar, spätestens nach 24 h) entsteht
  automatisch ein **Spoiler-Carousel**: Cover mit Spoiler-Warnung, danach die Karten.
- **Bann- und Game-Changer-Änderungen** für Commander werden automatisch zum Einzelbild-Entwurf.
- **Neue Commander** erscheinen zusätzlich einzeln im Feed.
- **Eigene News:** Kartennamen (eine pro Zeile) oder eine Scryfall-Suche (`set:nau`) eingeben, dann
  wird daraus ein Spoiler-Carousel, ein Einzelbild oder eine Story.

News-Entwürfe kommen **zusätzlich** zum Wochenplan und blockieren keinen Tag. Keine Leaks: Scryfall
zeigt nur offiziell gespoilerte Karten.

## Combo-Reels (Commander Spellbook)

Typ „Combo-Reel“ im Wochenplan oder unter „Eigenen Post einplanen“ (Spellbook-Link, leer = automatisch).
Code: `src/combos/spellbook.ts` (API + Auswahl), `src/combos/comboDraft.ts` (Entwurf), `src/render/comboReel.ts` (Video).
Der Sprechtext läuft wie bei Deck-Reels durch `src/skills/ttsText.ts` und die Aussprache-Regeln.

Look und Schnitt nach dem `/stick-figure`-Skill aus
[claude-animation-skills](https://github.com/artemnovitckii/claude-animation-skills) (MIT), fest im Renderer
eingebaut, damit es ohne Claude auf dem Server läuft: Wischübergänge mit Bewegungsunschärfe, Handkamera-Drift,
Aufprall mit Strahlen, Wackeln und Blitz beim ×∞, Vignette und Körnung, Untertitel mit 1–2 Wörtern.
Soundeffekte (Whoosh, Pop, Ticks, Riser, Aufprall) und eine gezupfte Untermalung entstehen im Code
(`src/render/sound.ts`, keine Samples). Die Musik wird unter der Stimme per ffmpeg leiser gezogen.

### Combo-Vorrat

Commander Spellbook blockt Anfragen vom Server (HTTP 403). Dann nimmt die App Combos aus
`src/combos/seed.json` (~500 beliebte Combos, 2–3 Karten, ≤ 40 €). Automatisch gewählt werden
nur Combos ohne Sol Ring und ohne die Spellbook-Kennungen R (cEDH) und P (sehr stark).
Vorrat auffrischen: lokal `node scripts/update-combo-seed.js`, dann committen und pushen.
Per Link geht auf dem Server nur, was im Vorrat steht.
