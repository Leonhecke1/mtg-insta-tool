# MTG Deck-Tech Instagram-Generator — Projekt-Spezifikation

Tool, das aus einer Magic-the-Gathering-Commander-Deckliste automatisch einen
Instagram-Carousel-Post generiert (Slides als Bilder + Caption) und diesen
optional direkt über die Instagram Graph API veröffentlicht.

Instagram-Channel: **floating._.mana**

---

## Tech-Stack

- **Node.js** (TypeScript empfohlen)
- **Puppeteer** für das Slide-Rendering (HTML/CSS-Templates → Screenshot 1080×1350)
- Scryfall API für Kartendaten, Bilder und Cardmarket-EUR-Preise
- Optional: Moxfield API für Deck-Import per URL
- S3/Cloudflare R2 (oder anderer öffentlich erreichbarer Host) als Zwischenspeicher
  für den Instagram-Upload
- Instagram Graph API (Content Publishing) für den automatischen Post
- LLM-API (Anthropic) für die Gameplan-Text-Generierung

## Eingabe

Zwei Wege, beide unterstützen:

1. **Rohtext-Deckliste** mit Abschnitten:
   ```
   Commander: Miirym, Sentinel Wyrm

   1 Sol Ring
   1 Arcane Signet
   ...

   Maybeboard:
   1 Dragon Tempest
   ...
   ```
2. **Moxfield-URL** → `https://api.moxfield.com/v3/decks/all/{publicId}`
   liefert JSON inkl. Commander-Feld und Maybeboard.

Internes Deck-Modell nach Normalisierung:
`{ commander, mainboard: Card[], maybeboard: Card[] }`

## Kartendaten (Scryfall)

- Batch-Endpoint `POST /cards/collection`, max. 75 Identifier pro Request
- Benötigte Felder: `name`, `mana_cost`, `type_line`, `oracle_text`,
  `color_identity`, `image_uris` (`normal`, `art_crop`), `prices.eur`
- **Doppelseitige Karten:** `image_uris` liegt unter `card_faces[0].image_uris`,
  nicht auf Top-Level
- **Fehlende Preise:** `prices.eur` kann `null` sein → Fallback anzeigen, nie 0 €
- Rate-Limit ~10 req/s, mit Batch-Endpoint unkritisch
- `prices.eur` = Cardmarket-Trendpreis (offizielle Cardmarket-API ist für neue
  Entwickler praktisch nicht zugänglich, Scryfall ist der richtige Weg)
- Sonderzeichen in Kartennamen beachten (z. B. "Jötun Grunt")

## Slide-Struktur (max. 10 — API-Limit für Carousels!)

1. **Cover** — Commander-Name groß, Tagline (1 Satz), Badge "Deck Tech · EDH",
   Kartenanzahl + Farbkombi-Name + Gesamtpreis als Teaser-Leiste unten
2. **Kreaturen + Commander** — Crop-Grid (s. Design)
3. **Spells** (Instants + Sorceries) — Crop-Grid
4. **Artefakte + Verzauberungen** — Crop-Grid (Länder nur als Zahl erwähnen
   oder eigene Slide, falls Platz)
5. **Gameplan** — "Was macht das Deck?": 2–3 Absätze LLM-generiert aus
   Commander + Kartenliste (Strategie, Schlüsselsynergien, Wincondition),
   plus 3-Schritte-Zusammenfassung (01 Rampen / 02 … / 03 …)
6. **Preis** — Gesamtsumme groß, "Cardmarket-Trend" als Label,
   Top 5 teuerste Karten als Liste, Commander-Preis separat
7. **Upgrades** — Maybeboard-Karten im **Vollformat** (volle Kartenscans,
   es sind nur wenige), je Karte Einzelpreis + LLM-Einzeiler, warum die Karte
   ein Upgrade ist und was sie ersetzen könnte

Caption separat generieren: Kurzbeschreibung + Hashtags, als `caption.txt`.

## Design-System ("Floating Mana"-Look)

Bewusst KEIN dunkler Standard-Deck-Tech-Look. Hell, warm, editorial:

- **Hintergrund:** warmer Papierton `#F4EFE4`
- **Text:** fast-schwarz `#1F1D18` (Headlines, 500er-Gewicht),
  gedämpft `#7A7263` / `#9A8F7A` (Sekundärtext)
- **Karten-Kacheln:** weiße Cards `#FFFFFF`, `border-radius: 8px`
- **Markenzeichen — schwebende Mana-Kreise:** große, teils vom Rand
  angeschnittene Kreise in MTG-Farbtönen, leicht rotiert, "schwerelos"
  über die Slides verteilt. Farben dynamisch aus der `color_identity`
  des Decks: W `#F8E7B9`, U `#B6CFE8`, B `#A69F8D`, R `#EFA98B`, G `#C2D8CB`
- **Mana-Symbole:** echte Symbole in den Kreisen und bei Manakosten via
  Mana-Font von Andrew Gioia (https://mana.andrewgioia.com, npm: `mana-font`)
- **Handle-Signatur:** `floating._.mana` dezent auf jeder Slide
- **Format:** 1080×1350 px (4:5)

### Crop-Grid (Kartenlisten-Slides)

- Grid 3–4 Spalten im 1080er-Format
- Jede Kachel = oberer Ausschnitt (~25 %) des echten Kartenscans:
  Art-Streifen oben, darunter weiße Zeile mit Kartenname + Manakosten
- Umsetzung rein per CSS: Container mit `overflow: hidden`,
  `<img>` mit `object-fit: cover; object-position: top` — kein manuelles
  Zuschneiden nötig
- Gruppen-Header pro Slide: z. B. "Kreaturen **24**" + Farbidentitäts-Pips
  rechts oben

## Rendering-Pipeline

Deckliste → Parser → Scryfall-Anreicherung → HTML-Template pro Slide →
Puppeteer-Screenshot 1080×1350 → PNG-Dateien → (optional) Upload + Publish.

Immer zuerst lokal als Dateien ablegen (`out/slide-01.png` … + `caption.txt`),
Publishing ist ein separater, expliziter Schritt.

## Instagram-Publishing (Graph API)

Voraussetzungen:
- Business- oder Creator-Account
- Meta-Developer-App; mit "Instagram API with Instagram Login" ist für den
  EIGENEN Professional-Account kein App-Review nötig (Dev-Modus reicht)
- API akzeptiert nur öffentlich erreichbare `image_url`s → Slides vor dem
  Publish auf S3/R2 hochladen, danach aufräumen

Flow:
1. Pro Slide: `POST /{ig-user-id}/media` mit `image_url` + `is_carousel_item=true`
2. Carousel-Container: `media_type=CAROUSEL`, `children=[ids]`, `caption=...`
3. `POST /{ig-user-id}/media_publish` mit Container-ID
4. Limit: max. **10 Bilder pro Carousel** (API-Limit, App kann manuell 20),
   100 API-Posts / 24 h

WICHTIG: Preview-Schritt einbauen — erst rendern und anzeigen/ablegen,
Publish nur mit explizitem `--publish`-Flag oder Bestätigung. Standard ist
Dry-Run. Instagram-API-Details vor Implementierung gegen die aktuelle
Meta-Doku verifizieren (Endpoints ändern sich gelegentlich).

## MVP-Reihenfolge (jeder Schritt einzeln testbar)

1. Parser (Rohtext + Moxfield) + Scryfall-Modul → JSON-Output
2. Rendering-Pipeline mit EINEM Template (Cover) — validiert Puppeteer-Setup
3. Restliche Slide-Templates + Caption-Generierung
4. S3/R2-Upload-Modul
5. Instagram-Publishing (erst gegen Test-Account)
6. LLM-Gameplan-Text + Upgrade-Einzeiler als Feinschliff

## Bekannte Stolpersteine (Checkliste)

- [ ] `card_faces` bei doppelseitigen Karten
- [ ] `prices.eur: null` → Fallback
- [ ] Maybeboard sauber vom Mainboard trennen (Parser + Moxfield)
- [ ] Max. 10 Slides einhalten, Layout muss bei 100 Karten aufgehen
- [ ] Umlaute/Sonderzeichen im Parser
- [ ] Farbidentität → dynamische Mana-Kreis-Farben pro Deck
