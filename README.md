# weg.li → Gladbeck Fremdanzeigen

[![CI](https://github.com/scne59/weg.li-gladbeck/actions/workflows/ci.yml/badge.svg)](https://github.com/scne59/weg.li-gladbeck/actions/workflows/ci.yml)
[![Lizenz: MIT](https://img.shields.io/badge/Lizenz-MIT-blue.svg)](LICENSE)

Kleines CLI-Tool, das die eigenen Anzeigen über die weg.li-API exportiert und daraus
Einträge im offiziellen Online-Formular **„Fremdanzeigen (Halt- oder Parkverstöße)“**
der Stadt Gladbeck vorbereitet bzw. einreicht.

> **Inoffiziell.** Dieses Projekt steht in keiner Verbindung zu weg.li oder der
> Stadt Gladbeck. Es ist keine Rechtsberatung.

> **Wichtig:** Das Tool ist keine offizielle Schnittstelle der Stadt Gladbeck. Es
> bedient das öffentliche Webformular mit einem Browser (Puppeteer/Chrome). Änderungen
> am Formular können das Tool brechen.

---

## Rechtlicher Hinweis (bitte lesen)

Das Gladbecker Formular selbst zeigt folgenden Hinweis an:

> „Die Überwachung des ruhenden Verkehrs ist eine hoheitliche Aufgabe, die
> grundsätzlich von den Ordnungsbehörden und der Polizei wahrzunehmen ist. Das
> anlasslose Anzeigen von Parkverstößen durch Privatpersonen ohne das Vorliegen einer
> persönlichen Betroffenheit könnte einen Verstoß gegen die Datenschutzgrundverordnung
> begründen.“

Außerdem gilt laut Formular: **Der Verstoß darf nicht länger als fünf Tage her sein.**

Das Tool ist dafür gedacht, **eigene, selbst beobachtete** Anzeigen zu übertragen.
Bitte keine fremden oder veralteten Sachverhalte massenhaft einreichen. Die Nutzung
erfolgt auf eigene Verantwortung; prüfe vor dem Einreichen jede Anzeige in der
Vorschau.

---

## Funktionsumfang

* **Export:** Alle eigenen Anzeigen als JSON oder CSV (optional mit Fotos).
* **Liste:** Übersicht mit Datum, PLZ, Kennzeichen, Tatbestand, Alter und Importstatus.
* **Import:** Füllt das Gladbecker Formular Schritt für Schritt aus:
  1. Einleitung
  2. Zeugendaten / Anzeigeerstatter
  3. Zeitpunkt und Ort
  4. Art des Verstoßes
  5. Wichtiger Hinweis
  6. Angaben zum Fahrzeug
  7. Beschreibung und Beweisbilder
  8. Richtigkeit
  9. Abschluss (Vorschau / Verbindlich einreichen)
* **Trockenlauf (Standard):** Das Formular wird komplett ausgefüllt, aber **nicht**
  abgeschickt. Es wird ein Screenshot und optional eine PDF-Vorschau gespeichert.
* **Einreichen:** Nur mit `--submit --yes`.
* **Duplikatschutz:** Bereits eingereichte Anzeigen werden über `state.json`
  (Token **und** Fingerabdruck aus PLZ + Kennzeichen + Startzeit + TBNR) erkannt
  und übersprungen. Manuell eingereichte Anzeigen lassen sich mit `mark`
  kennzeichnen.
* **Fotoaufbereitung:** Fotos werden automatisch gedreht, verkleinert und als JPEG
  unter 2 MB gespeichert (Vorgabe des Formulars).
* **Profilübernahme:** Persönliche Daten aus der eingeloggten weg.li-Profilseite
  lesen (`profile --browser`) oder aus gespeichertem HTML (`profile --html`).

---

## Voraussetzungen

* Node.js ≥ 18
* Google Chrome oder Chromium
* Internetzugang
* weg.li-API-Key (Profilseite: <https://www.weg.li/user>)

Getestet unter Linux mit Node 20 und Chrome 158.

---

## Installation

```bash
git clone https://github.com/scne59/weg.li-gladbeck.git
cd weg.li-gladbeck
npm install
```

Abhängigkeiten:

* `puppeteer-core` (Browsersteuerung, Chrome/Chromium wird separat benötigt)
* `sharp` (Bildverarbeitung)
* `dotenv` (API-Key aus `.env`)

---

## Konfiguration

### 1. API-Key (`.env`)

```bash
cp .env.example .env
chmod 600 .env
```

Dann den Key in `.env` eintragen:

```dotenv
WEGLI_API_KEY=…
```

Den Key nicht weitergeben und nicht in Screenshots/Logs veröffentlichen. `.env`
steht in `.gitignore`.

### 2. Persönliche Angaben (`config.json`)

```bash
cp config.example.json config.json
chmod 600 config.json
```

`config.json` enthält die Daten, die im Formular als **Anzeigeerstatter** eingetragen
werden. Bitte vollständig ausfüllen:

```json
{
  "person": {
    "anrede": "Herr",
    "name": "Nachname",
    "vorname": "Vorname",
    "strasse": "Straße",
    "hausnummer": "1",
    "plz": "45964",
    "ort": "Gladbeck",
    "geburtsdatum": "01.01.1985",
    "telefon": "",
    "email": "name@example.de"
  }
}
```

* `geburtsdatum`: `TT.MM.JJJJ` oder `JJJJ-MM-TT`
* `telefon` ist optional
* `anrede`: `Herr`, `Frau` oder `Divers`

Weitere Optionen:

| Feld | Bedeutung | Standard |
| --- | --- | --- |
| `gladbeck.fahrzeugart` | Auswahl im Formular | `PKW (Auto)` |
| `gladbeck.headless` | Browser unsichtbar | `true` |
| `gladbeck.chromePath` | Pfad zu Chrome (sonst automatisch) | `null` |
| `gladbeck.delaySeconds` | Pause zwischen Anzeigen | `30` |
| `gladbeck.maxAgeDays` | Max. Alter der Anzeige | `5` |
| `gladbeck.allowedZips` | Relevante PLZ | `45964`, `45966`, `45968` |
| `import.photoMode` | Fotoaufteilung: `auto`, `reuse`, `all-vehicle` | `auto` |
| `import.includeTokenInDescription` | weg.li-Token in Beschreibung | `false` |
| `import.skipNoteMarker` | Regex: Notiz-Marker zum Überspringen | `\[GLA-Fremdanzeige[^\]]*\]` |
| `import.tbnrMap` | Eigene TBNR→Checkbox-Zuordnung | `{}` |

Prüfen:

```bash
node cli.js doctor
```


### Profildaten aus weg.li übernehmen

Die weg.li-**API** liefert die persönlichen Daten des Anzeigeerstellers nicht.
Es gibt im `/api`-Namespace keinen Endpunkt für das Profil, und weder die
Anzeigen-JSONs noch die Export-CSV enthalten Name, Anschrift oder
Geburtsdatum. Diese Daten liegen nur hinter dem weg.li-Web-Login auf
<https://www.weg.li/user/edit>.

Das Tool kann sie trotzdem übernehmen – über die Profilseite:

```bash
# Browser öffnet sich, du loggst dich bei weg.li ein, danach wird gelesen
node cli.js profile --browser --anrede Herr

# Daten direkt in config.json schreiben
node cli.js profile --browser --anrede Herr --write

# Alternative ohne Login: Profilseite im Browser speichern und HTML einlesen
node cli.js profile --html ~/wegli-profil.html --write
```

Übernommen werden:

| weg.li-Feld | config.json |
| --- | --- |
| `name` (vollständig) | `vorname` + `name` (am letzten Leerzeichen getrennt) |
| `street` (inkl. Hausnummer) | `strasse` + `hausnummer` |
| `zip` | `plz` |
| `city` | `ort` |
| `date_of_birth` | `geburtsdatum` (`TT.MM.JJJJ`) |
| `phone` | `telefon` |
| `email` | `email` |

Nicht übernehmbar:

* **Anrede** – wird von weg.li nicht gespeichert. Bitte mit `--anrede Herr`,
  `--anrede Frau` oder `--anrede Divers` setzen; sonst bleibt der bisherige Wert
  aus `config.json` erhalten.
* **Zusatz / c/o** (`appendix`) – das Gladbecker Formular hat dafür kein Feld.

Ohne `--write` werden die Daten nur angezeigt (Trockenlauf). Der Browser-Login
wird im Ordner `.chrome-profile/` gespeichert (in `.gitignore`), damit man sich
nicht bei jedem Lauf neu anmelden muss.

---

## Benutzung

### Übersicht der Anzeigen

```bash
node cli.js list
node cli.js list --all-days          # auch ältere Anzeigen
node cli.js list --all-zips          # auch außerhalb Gladbecks
node cli.js list --json
```

Standardfilter: max. 5 Tage alt, PLZ 45964/45966/45968.

### Exportieren

```bash
node cli.js export --format json --out export/anzeigen.json
node cli.js export --format csv  --out export/anzeigen.csv
node cli.js export --format json --all-days --photos
```

CSV ist für deutsches Excel optimiert (UTF-8-BOM, Semikolon).

### Import – Trockenlauf (empfohlen)

```bash
# Alle passenden Anzeigen vorbereiten, nicht einreichen
node cli.js import

# Nur eine bestimmte Anzeige
node cli.js import --token 0123456789abcdef0123456789abcdef --preview

# Offline aus einem zuvor erzeugten JSON-Export
node cli.js import --input export/anzeigen.json --limit 1 --preview

# Mit sichtbarem Browser und 120 s Pause vor dem Schließen
node cli.js import --token 0123456789abcdef0123456789abcdef --headful --preview --pause 120
```

Ergebnis pro Anzeige in `output/<token>/`:

* `vor-einreichung.png` – Screenshot des fertigen Formulars
* `vor-einreichung.html` – HTML-Snapshot
* `vorschau.png` – Screenshot der PDF-Vorschau (mit `--preview`)

### Bereits manuell eingereichte Anzeigen markieren

Wenn du eine Anzeige schon selbst über das Gladbecker Formular eingereicht hast,
markiere sie lokal. Sie wird dann nie wieder über das Formular eingereicht:

```bash
# über Kennzeichen und Datum
node cli.js mark --plate "GLA AB 123" --date 15.11.2026 --note "manuell eingereicht"

# oder über den weg.li-Token
node cli.js mark --token d446e7adf01c342900b2544bed162b21

# Markierung wieder entfernen
node cli.js mark --plate "GLA AB 123" --date 15.11.2026 --unmark
```

Die Markierung erscheint in `node cli.js list` in der Spalte `Import` als `manual`
und liegt in `state.json`. Diese Datei ist der lokale „Gedächtnisstand“ – bitte
aufbewahren bzw. mitsichern. `--force` überschreibt eine `manual`-Markierung
absichtlich nicht; zum erneuten Einreichen zuerst `--unmark` verwenden.

### Import – verbindlich einreichen

```bash
node cli.js import --submit --yes
```

Ohne `--yes` wird interaktiv nachgefragt. In nicht-interaktiven Umgebungen ist
`--yes` Pflicht.

Weitere Optionen:

```bash
--days 3             # engeres Zeitfenster
--all-days           # alle Anzeigen (Formular lehnt > 5 Tage ggf. ab)
--all-zips           # auch außerhalb Gladbecks
--limit 3            # nur die ersten 3
--force              # bereits eingereichte erneut versuchen
```

---

## Wie die Zuordnung funktioniert

### Tatbestand → Checkbox

Die weg.li-TBNR wird auf die Checkboxen im Gladbecker Formular abgebildet, z. B.:

| TBNR | weg.li-Beschreibung | Checkbox |
| --- | --- | --- |
| 112454, 112655, 112656 | Parken auf dem Gehweg | `Gehweg` |
| 112474, 141174, 141775 | Parken auf Radweg/Radfahrstreifen | `Radweg` |
| 141194 | Geh- und Radweg | `Gehweg` + `Radweg` |

Unbekannte Tatbestände werden über Schlüsselwörter zugeordnet, sonst
`sonstiger Halt- oder Parkverstoß`. Eigene Zuordnungen können in
`config.json → import.tbnrMap` hinterlegt werden:

```json
"tbnrMap": {
  "112454": ["Gehweg"],
  "141194": ["Gehweg", "Radweg"]
}
```

### Fotos

Das Formular verlangt mindestens:

* „Foto des Fahrzeugs 1“
* „Foto der Verkehrssituation 1“

Standard (`photoMode: "auto"`):

* 1 Foto → dasselbe Bild für Fahrzeug und Verkehrssituation (Warnung im Log)
* 2 Fotos → Foto 0 = Fahrzeug, Foto 1 = Verkehrssituation
* 3+ Fotos → Foto 0 = Fahrzeug, Fotos 1…n = Verkehrssituation

Alle Fotos werden vorher auf max. 2 MB verkleinert.

### Straße/Hausnummer

weg.li liefert die Straße oft inklusive Hausnummer (z. B. `Musterstraße 12`). Das Tool
trennt das automatisch in `Straße` und `Hausnummer`.

### Zeitpunkt

Beginn und Ende werden aus `start_date`/`end_date` in Europe/Berlin umgerechnet.
Das Gladbecker Formular kennt nur **eine Uhrzeit am selben Tag**. Anzeigen, deren
Ende auf den Folgetag fällt, werden mit Fehlermeldung übersprungen.

---

## Status und Duplikatschutz

`state.json` speichert pro weg.li-Token:

* `prepared` – Trockenlauf, nichts eingereicht
* `submitting` – Einreichung wurde geklickt, aber nicht bestätigt
* `submitted` – erfolgreich eingereicht
* `failed` – Fehler (Details im Feld `error`)

Zusätzlich speichert jeder Eintrag einen **Fingerabdruck** aus
`PLZ | Kennzeichen | Startzeit | TBNR`. Dadurch wird auch dann nicht doppelt
eingereicht, wenn sich der weg.li-Token ändert oder die Anzeige unter einem
anderen Token erneut auftaucht.

`submitted`, `submitting` und `manual` werden beim nächsten Lauf übersprungen.
Nach einem Abbruch während der Einreichung bitte zuerst im Portal/Postfach
prüfen, dann gegebenenfalls `--force` verwenden.

### Marker in weg.li selbst?

Die weg.li-API erlaubt das Ändern der Notiz (`note`) nur bei Anzeigen im Status
`open` (Entwurf). Sobald eine Anzeige über weg.li geteilt wurde, hat sie den
Status `shared` – dann sind `PATCH /notices/{token}` und damit auch ein
Notiz-Marker per API nicht mehr möglich. Ein eigener Status „bei Stadt X
eingereicht“ existiert in weg.li nicht.

`--wegli` versucht den Marker trotzdem und erklärt bei `shared`-Anzeigen, warum
es nicht geht:

```bash
node cli.js mark --plate "GLA AB 123" --date 15.11.2026 --wegli
```

Der zuverlässige Marker ist deshalb `state.json`. Zusätzlich überspringt das Tool
Anzeigen, deren weg.li-Notiz den Marker `[GLA-Fremdanzeige …]` enthält
(konfigurierbar über `import.skipNoteMarker`).

---

## Tests

```bash
npm test
```

Die Tests nutzen Nodes eingebautes `node:test` und benötigen weder Chrome noch
Netzwerk. Sie prüfen Straßen-/Namensaufteilung, TBNR-Zuordnung, Profil-Parsing und
den Duplikatschutz in `state.json`.

GitHub Actions führt die Tests bei jedem Push und Pull Request aus
(`.github/workflows/ci.yml`).

---

## Projektstruktur

```text
cli.js                 Kommandozeile (doctor, list, export, import, mark, profile)
src/wegli.js           weg.li-API-Client
src/gladbeck.js        Browser-Automatisierung des Gladbecker Formulars
src/mapping.js         TBNR -> Checkbox, Beschreibungstext
src/photos.js          Fotoaufbereitung (< 2 MB) und Verteilung auf die Upload-Felder
src/profile.js         Profildaten aus weg.li (Browser oder gespeichertes HTML)
src/store.js           Duplikatschutz (Token + Fingerabdruck)
src/config.js          Konfiguration und Validierung
src/util.js            Datum-, Straßen- und Hilfsfunktionen
test/                  node:test-Tests
```

---

## Grenzen und Hinweise

* Das Formular ist ein zustandsbehafteter Wicket-Wizard. Das Tool navigiert über
  Beschriftungen und Panel-Namen, nicht über feste Feld-IDs. Kleinere
  Formularänderungen können trotzdem Anpassungen erfordern.
* Die Stadt prüft die 5-Tage-Regel. Ältere Anzeigen werden vom Tool standardmäßig
  ausgefiltert; `--all-days` erzwingt den Versuch.
* Nur Anzeigen aus Gladbeck (PLZ 45964/45966/45968) werden standardmäßig verarbeitet.
* Bei nur einem Foto wird dasselbe Bild zweimal verwendet. Das ist ein Kompromiss,
  weil das Formular zwei Kategorien verlangt. Bitte in der Vorschau prüfen.
* Kein offizieller Support durch weg.li oder die Stadt Gladbeck.

---

## Problemlösung

**Chrome nicht gefunden**

```bash
export CHROME_PATH=/usr/bin/google-chrome
# oder in config.json: "gladbeck": { "chromePath": "/usr/bin/google-chrome" }
```

**„Formular ist nicht weitergesprungen“**

Meist ein Pflichtfeld oder eine Validierungsmeldung. Der Screenshot unter
`output/<token>/fehler.png` zeigt die Stelle. Häufige Ursachen: fehlendes
Geburtsdatum, ungültige E-Mail, Ende am Folgetag, keine Checkbox bei „Art des
Verstoßes“.

**„Bitte zuerst config.json ausfüllen“**

`node cli.js doctor` zeigt die fehlenden Felder.

**Vorschau/PDF**

`--preview` öffnet die Vorschau in einem neuen Tab und speichert einen Screenshot.
Der originale PDF-Download erfolgt bewusst nicht automatisch.

---

## Sicherheit

* `.env`, `config.json`, `state.json`, `output/`, `cache/` und `export/` sind in
  `.gitignore` eingetragen.
* `state.json` und `output/` enthalten personenbezogene Daten (Name, Anschrift,
  Kennzeichen, Fotos). Nicht veröffentlichen.
* Der API-Key wird nur an `www.weg.li` gesendet (`X-API-KEY`), niemals an die
  Stadt Gladbeck. An das Formular gehen nur die Anzeigedaten.

---

## Lizenz

MIT – siehe [LICENSE](LICENSE).
