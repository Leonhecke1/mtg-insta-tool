# mtg-insta-tool

MTG-Commander-Deckliste einfuegen &rarr; Instagram-Carousel-Post (Slides +
Caption) generieren &rarr; optional zeitgesteuert automatisch auf
`floating._.mana` veroeffentlichen.

Siehe `SPEC.md` fuer die vollstaendige Projekt-Spezifikation (Design-System,
Slide-Struktur, Instagram-API-Flow etc.). Dieses README beschreibt nur
Setup und Betrieb.

## Setup

```bash
npm install
cp .env.example .env
# .env ausfuellen (siehe unten)
npm run build
npm start
```

Waehrend der Entwicklung: `npm run dev` (Hot-Reload via ts-node-dev).

Ohne Web-UI direkt in der Konsole testen (rendert nur lokal, published nie):

```bash
npm run generate -- ./meine-deckliste.txt
npm run generate -- --moxfield https://www.moxfield.com/decks/xxxxxxxx
npm run generate -- ./meine-deckliste.txt --no-llm   # ohne Anthropic-Aufruf, Platzhaltertexte
```

Ergebnis liegt danach in `out/<jobId>/slide-01.png` ... + `caption.txt`.

## .env konfigurieren

| Variable | Erforderlich fuer | Hinweis |
|---|---|---|
| `PORT` | Server | Default 3000 |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | Web-UI-Schutz | **Unbedingt setzen**, sobald der Server oeffentlich erreichbar ist |
| `ANTHROPIC_API_KEY` | Gameplan-/Upgrade-/Caption-Texte | Ohne Key: automatischer Fallback auf Platzhaltertexte |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL` | Instagram-Publish | Cloudflare R2 empfohlen (siehe SPEC.md); nur noetig, sobald wirklich (nicht als Dry-Run) veroeffentlicht wird |
| `IG_USER_ID`, `IG_ACCESS_TOKEN` | Instagram-Publish | Instagram-Business/Creator-Account, Meta-App mit "Instagram API with Instagram Login" |

Scryfall und Moxfield brauchen keine Keys.

**Wichtig:** Instagram-Graph-API-Endpoints aendern sich gelegentlich
(`src/publish/instagram.ts`, aktuell `v21.0`). Vor dem ersten echten Publish
gegen die aktuelle Meta-Doku pruefen:
https://developers.facebook.com/docs/instagram-platform/content-publishing

## Benutzung (Web-UI)

1. Server starten, `http://<server>:3000` oeffnen (Basic-Auth-Login).
2. Deckliste als Rohtext einfuegen oder Moxfield-URL angeben.
3. Einstellungen waehlen:
   - **Wann posten?** leer = sofort (nach Bestaetigung), oder Datum/Uhrzeit
     fuer zeitgesteuerten Post.
   - **LLM-Texte generieren** an/aus (aus = schneller Preview ohne
     Anthropic-Kosten).
   - **Dry-Run** ist standardmaessig aktiv: es wird NUR gerendert, nichts
     auf Instagram gepostet. Erst wenn diese Checkbox deaktiviert wird und
     man den Bestaetigungsdialog bejaht, kann wirklich gepostet werden.
4. "Generieren" klicken. Die Slides erscheinen nach kurzer Zeit (Puppeteer +
   Scryfall + ggf. LLM brauchen ein paar Sekunden) als Vorschau im Job.
5. Bei Dry-Run/geplanten Jobs: ueber "Jetzt veroeffentlichen" manuell
   bestaetigen, oder bei einer Terminierung laeuft der Post automatisch zum
   eingestellten Zeitpunkt (Minuten-Tick prueft faellige Jobs).

Jobs, Status und geplante Zeitpunkte liegen persistent in
`data/jobs.json` (lowdb/JSON) - ueberlebt Server-Neustarts.

## Deployment auf einem Server

Das Scheduling (zeitgesteuertes Posten) braucht einen **dauerhaft
laufenden Node-Prozess** (kein Serverless/Lambda) - der Minuten-Cron-Tick
in `src/scheduler/scheduler.ts` prueft faellige Jobs nur, waehrend der
Prozess laeuft.

Empfehlung: [pm2](https://pm2.keymetrics.io/) oder systemd.

```bash
npm run build
pm2 start dist/server.js --name mtg-insta-tool
pm2 save
```

Puppeteer braucht auf einem frischen Linux-Server ggf. zusaetzliche
Chromium-Abhaengigkeiten (`libnss3`, `libatk-bridge2.0-0`, etc.) - siehe
[Puppeteer Troubleshooting](https://pptr.dev/troubleshooting).

Server unbedingt hinter Basic-Auth (`.env`) oder einen eigenen
Reverse-Proxy mit Auth stellen, bevor er oeffentlich erreichbar ist - das
Tool kann echte Instagram-Posts ausloesen.

## Architektur-Kurzueberblick

```
src/
  parser/        Rohtext- und Moxfield-Parser -> RawDeckList
  scryfall/       Batch-Anreicherung -> Deck (EnrichedCard[])
  llm/            Anthropic-Textgenerierung (+ Fallback ohne LLM)
  render/         HTML/CSS-Templates pro Slide + Puppeteer-Renderer
  publish/        S3/R2-Upload + Instagram Graph API
  scheduler/      Job-Persistenz (lowdb) + Minuten-Cron fuer faellige Posts
  pipeline.ts     Orchestriert Parser -> Scryfall -> Render -> Texte -> Dateien
  server.ts       Express-Server + REST-API fuer das Web-UI
  cli.ts          Lokales Testen ohne Server
public/           Statisches Web-UI (Vanilla HTML/CSS/JS, kein Build-Step)
```

## Bekannte Einschraenkungen / offene Punkte

- Instagram- und Moxfield-API-Antwortformate sind gegen Stand der
  Implementierung geprueft, aber beide APIs sind nicht (offiziell) stabil
  versioniert - bei Fehlern zuerst hier ansetzen.
- Slide-Design ist funktional nach SPEC.md umgesetzt, aber nicht
  pixelgenau gegen ein Figma-Mockup abgeglichen - bei Bedarf CSS in
  `src/render/slides/*.ts` und `src/render/theme.ts` anpassen.
- Keine Bild-Caching-/Retry-Logik fuer Scryfall-Bild-URLs beim
  Puppeteer-Rendering - bei sehr instabiler Verbindung ggf. Retry ergaenzen.
