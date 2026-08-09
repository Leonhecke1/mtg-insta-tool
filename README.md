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

LLM-Texte (Gameplan/Upgrades/Caption) sind standardmaessig AUS - ohne
`--llm` (bzw. im Web-UI ohne die Checkbox) werden Platzhaltertexte genutzt,
kein Anthropic-API-Aufruf noetig. Anthropics API wird separat vom
claude.ai/Claude-Code-Zugang abgerechnet (eigenes Guthaben noetig) - wer
das nicht will, laesst die LLM-Option einfach aus.

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
