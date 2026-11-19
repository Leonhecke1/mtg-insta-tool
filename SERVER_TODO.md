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

## 8b. Neu: Stimme mit Nari Labs Dia (optional, natürlicher als Piper)

[Dia](https://github.com/nari-labs/dia) (1,6 Mrd. Parameter, Englisch, kostenlos) klingt deutlich menschlicher als Piper. Es braucht aber **viel RAM** (CPU: ~8 GB frei) und ist ohne GPU **langsam** (mehrere Minuten pro Reel). Der Code ruft `scripts/dia_tts.py` auf, lädt das Modell einmal pro Reel und spricht alle Szenen mit derselben Stimme. Schlägt Dia fehl oder dauert es länger als `DIA_TIMEOUT_MIN`, nimmt er automatisch Piper.

- [ ] Erst prüfen und Leon melden: `nproc`, `free -h`, `df -h /opt`, `nvidia-smi` (GPU?). **Unter 8 GB freiem RAM: nicht installieren**, bei Piper bleiben
- [ ] **Vorher Leon fragen** (Download: Python-Pakete inkl. PyTorch ~1–2 GB, Modell ~6 GB von Hugging Face):
  ```
  sudo apt install -y python3-venv git
  python3 -m venv /opt/dia/venv
  /opt/dia/venv/bin/pip install --index-url https://download.pytorch.org/whl/cpu torch torchaudio
  /opt/dia/venv/bin/pip install git+https://github.com/nari-labs/dia.git
  sudo chown -R <dienst-user> /opt/dia
  ```
  (Mit NVIDIA-GPU stattdessen das CUDA-Torch-Paket.) Das Modell lädt beim ersten Lauf in den Hugging-Face-Cache des Dienst-Users.
- [ ] `.env`:
  ```
  TTS_ENGINE=dia
  DIA_PYTHON=/opt/dia/venv/bin/python
  DIA_VOICE_PROMPT=/opt/dia/voice.wav   # fehlt die Datei, wird die erste Aufnahme zur festen Stimme
  DIA_TIMEOUT_MIN=20
  ```
  Optional: `DIA_SEED` (andere Zahl = andere Stimme; danach `voice.wav`/`voice.txt` löschen), `DIA_TEMPERATURE` (Standard 1.6), `DIA_MODEL_ID`, `DIA_DEVICE`
- [ ] Neustart, Testlauf ohne Veröffentlichung: `cd /opt/mtg-insta-tool && echo '{"texts":["This combo goes infinite with just two cards.","Here is how it works."],"outDir":"/tmp","prefix":"dia-"}' > /tmp/dia.json && time sudo -u <dienst-user> /opt/dia/venv/bin/python scripts/dia_tts.py /tmp/dia.json`. Dauer und Spitzen-RAM an Leon melden, WAVs anhören lassen
- [ ] Gefällt die Stimme nicht: `voice.wav` und `voice.txt` löschen, `DIA_SEED` ändern, neues Reel erzeugen
- [ ] Ist es zu langsam oder fehlt RAM: `TTS_ENGINE=piper` (Standard) und Neustart

## 8c. Neu: Stimme mit VoiceStudio (Leons Wahl, statt Dia)

[VoiceStudio](https://github.com/debpalash/VoiceStudio) läuft als eigener Docker-Dienst neben dem Tool (Standard-Engine OmniVoice, Stimmen klonen/entwerfen). Das Tool ruft `POST http://127.0.0.1:3900/v1/audio/speech` (OpenAI-kompatibel) einmal pro Szene auf. Fällt VoiceStudio aus oder antwortet nicht innerhalb `VOICESTUDIO_TIMEOUT_SEC`, nimmt das Reel automatisch Piper.

- [ ] Erst prüfen und Leon melden: `nproc`, `free -h`, `df -h /var/lib/docker`, `docker --version`, `nvidia-smi`. Läuft nur auf x86_64 (amd64); auf CPU langsamer als Piper
- [ ] **Vorher Leon fragen** (Download: Docker-Image `ghcr.io/debpalash/voicestudio:stable` plus ~2,4 GB Modell beim ersten Start). Nur an localhost binden, dann braucht es keinen API-Key:
  ```
  docker run -d --name voicestudio --restart unless-stopped \
    -p 127.0.0.1:3900:3900 \
    -e OMNIVOICE_DATA_DIR=/app/omnivoice_data \
    -e OMNIVOICE_ANALYTICS_DISABLED=1 \
    -v voicestudio-data:/app/omnivoice_data \
    ghcr.io/debpalash/voicestudio:stable
  docker logs -f voicestudio      # warten, bis das Modell geladen ist
  curl -fsS http://127.0.0.1:3900/health
  ```
- [ ] Testlauf ohne Veröffentlichung: `curl -s http://127.0.0.1:3900/v1/audio/speech -H 'Content-Type: application/json' -d '{"model":"omnivoice","voice":"default","input":"Two cards, and you get infinite mana. Let me show you how that works.","response_format":"wav","language":"en"}' -o /tmp/vs.wav` → Dauer messen, Leon die Datei anhören lassen
- [ ] Verfügbare Stimmen: `curl -s http://127.0.0.1:3900/v1/audio/voices`. Eine eigene Stimme (klonen/entwerfen) legt Leon in der VoiceStudio-Oberfläche an (per SSH-Tunnel `ssh -L 3900:127.0.0.1:3900 server`, dann http://localhost:3900), danach ihre ID oder ihren Namen in `VOICESTUDIO_VOICE`
- [ ] `.env`:
  ```
  TTS_ENGINE=voicestudio
  VOICESTUDIO_URL=http://127.0.0.1:3900
  VOICESTUDIO_MODEL=omnivoice
  VOICESTUDIO_VOICE=feat_17_the_commentator
  VOICESTUDIO_INSTRUCTIONS=friendly, relaxed, conversational
  ```
  Optional: `VOICESTUDIO_SPEED` (1.0), `VOICESTUDIO_TIMEOUT_SEC` (300 pro Szene), `VOICESTUDIO_API_KEY` (nur wenn VoiceStudio auf einem anderen Rechner läuft; Leon trägt ihn selbst ein)
- [ ] **Eine Stimme für alles:** Leon will durchgehend `feat_17_the_commentator` (VoiceStudio-Archetyp). Beim ersten Reel legt das Tool daraus einmal das Klon-Profil `floating-mana-feat_17_the_commentator` an (Log: `[tts] VoiceStudio: Stimme ... festgehalten`) und nutzt es danach für jede Szene. Mit `VOICESTUDIO_VOICE=default` erfindet das Modell pro Szene eine neue Stimme – nie so lassen
- [ ] Prüfen: `curl -s http://127.0.0.1:3900/archetypes/feat_17_the_commentator` liefert den Archetyp (sonst Leon melden)
- [ ] Neustart, ein Combo-Reel erzeugen, Log auf `[tts] VoiceStudio fehlgeschlagen` prüfen, anhören: alle Szenen dieselbe Stimme? Entwurf danach ablehnen
- [ ] Lizenz: VoiceStudio selbst ist AGPL-3.0 und läuft unverändert als eigener Dienst (wir binden keinen Code ein). **Achtung:** Das Standardmodell **OmniVoice** führt VoiceStudio in `docs/licensing/model-inventory.md` als **nicht kommerziell**. Für einen Hobby-Account ok, sobald floating.mana Geld verdient (Sponsoring, Affiliate) nicht mehr. Leon entscheidet; ein anderes Modell wird über `VOICESTUDIO_MODEL` gewählt (Lizenz vorher in derselben Datei prüfen)

## 8d. Neu: Stimme mit Kokoro (ersetzt VoiceStudio, Server war zu schwach)

[Kokoro](https://github.com/thewh1teagle/kokoro-onnx) hat ~82 Mio. Parameter (int8-Modell ~88 MB) und läuft ohne GPU in Echtzeit oder schneller. Apache-2.0, kommerziell nutzbar. Feste Stimme = jede Szene gleich. Der Code ruft `scripts/kokoro_tts.py` auf (Modell einmal pro Reel geladen), bei Fehler springt Piper ein.

- [ ] VoiceStudio stoppen: `docker stop voicestudio && docker update --restart=no voicestudio`. Ob Container, Image und Volume (`voicestudio-data`) gelöscht werden sollen: **Leon fragen**
- [ ] **Vorher Leon fragen** (Download: Python-Pakete ~100 MB, Modell ~88 MB + Stimmen ~27 MB von GitHub):
  ```
  sudo apt install -y python3-venv
  sudo mkdir -p /opt/kokoro && sudo chown <dienst-user> /opt/kokoro
  python3 -m venv /opt/kokoro/venv
  /opt/kokoro/venv/bin/pip install kokoro-onnx soundfile
  cd /opt/kokoro
  curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx
  curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
  ```
- [ ] Testlauf ohne Veröffentlichung, Dauer und RAM messen:
  ```
  cd /opt/mtg-insta-tool
  echo '{"texts":["Two cards, and you get infinite mana. Let me show you how that works.","First up, Dramatic Reversal, which untaps all nonland permanents you control."],"outDir":"/tmp","prefix":"kok-","model":"/opt/kokoro/kokoro-v1.0.int8.onnx","voices":"/opt/kokoro/voices-v1.0.bin","voice":"am_michael"}' > /tmp/kok.json
  /usr/bin/time -v /opt/kokoro/venv/bin/python scripts/kokoro_tts.py /tmp/kok.json
  ```
  `/tmp/kok-0.wav` und `/tmp/kok-1.wav` Leon zum Anhören geben (gleiche Stimme in beiden?)
- [ ] `.env`:
  ```
  TTS_ENGINE=kokoro
  KOKORO_VOICE=am_michael
  ```
  Andere männliche Stimmen zum Vergleich: `am_adam`, `am_fenrir`, `am_puck`, `bm_george` (britisch). Optional `KOKORO_SPEED` (1.0), Pfade `KOKORO_PYTHON`, `KOKORO_MODEL`, `KOKORO_VOICES` (Standard wie oben)
- [ ] Neustart, ein Combo-Reel erzeugen, Log auf `[tts] Kokoro fehlgeschlagen` prüfen, Entwurf danach ablehnen

## 9. Nach dem Test an Leon zurückmelden

- Was läuft, was nicht (mit Logzeilen, ohne Secrets)
- Ob Reels sich bewegen und ob Ton da ist
- Ob doppelte Entwürfe gefunden wurden und woher sie kamen
- Ob der Branch nach `main` gemergt werden soll (nur auf Leons Ansage)
