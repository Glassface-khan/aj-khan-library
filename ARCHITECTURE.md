# Architektur der Autorenseite (aj-khan-library)

*Rekonstruiert aus dem tatsächlichen `index.html` im Repo, nicht aus der im Handoff erwähnten ZIP (die im neuen Chat nicht mit hochgeladen wurde). Stand: 20. August 2026.*

Dieses Dokument klärt die vier offenen Fragen aus dem Handoff-Dokument
(„Was die ZIP beim Öffnen klären soll") und hält die Architekturentscheidung
fest, die als Ergebnis dieser Analyse getroffen wurde.

---

## 1 · Was `index.html` wirklich ist

Die 9-MB-Datei ist **kein handgeschriebenes Monolith-HTML**, sondern der
kompilierte Export eines **Claude-Design-Canvas** ("Bundler"-Format, erkennbar
an `<script type="__bundler/manifest">`, `<script type="__bundler/template">`
etc.). Der eigentliche Seiteninhalt (Layout, Texte, Admin-Formulare, Logik)
steckt als JSON-String im `__bundler/template`-Script-Tag; der Rest der
Dateigröße sind eingebettete Bilder/Fonts als Base64 im `__bundler/manifest`.

**Konsequenz für die Weiterentwicklung:** Solange die Seite weiter über
Claude-Design-Chats ("exportiere die aktualisierte Seite") gepflegt wird,
überschreibt jeder neue Export lokale Änderungen an `index.html` restlos —
das erklärt auch das Git-Log-Muster (`Add files via upload` /
`Delete index.html` im Wechsel, insgesamt 20 Commits, nie ein Diff-basierter
Commit).

**→ Entscheidung (20.08.2026, mit dem Autor abgestimmt):** Ab sofort ist
**Claude Code / dieses Repo die Source of Truth** für die Seite, nicht mehr
Claude Design. Strukturelle Änderungen laufen künftig als normale Commits
hier, nicht mehr als Re-Export+manueller Upload. Claude Design wird für
diese Seite nicht mehr als Publish-Quelle verwendet.

---

## 2 · Wie der Admin-Bereich technisch läuft

Vollständig **clientseitig**, kein eigenes Backend außer dem unten
beschriebenen Google-Apps-Script. Ablauf:

1. `index.html` lädt beim Öffnen die Seed-Daten aus einem eingebetteten
   `<script id="author-data" type="application/json">`-Tag (Bio, feste
   Passwörter, Gedichte, die 13 Bücher zum Zeitpunkt des letzten Exports).
2. Direkt danach ruft die Seite `fetch(SCRIPT_URL + '?action=getBooks')` auf
   und **überschreibt** die Seed-Bücher mit dem Live-Stand aus dem
   Apps-Script-Backend (Details siehe Abschnitt 3) — falls die Antwort ein
   nicht-leeres Array liefert.
3. Der "Admin"-Button öffnet ein reines Client-Login (`isAdmin`-State),
   das Passwort wird lokal mit `state.settings.adminPassword` verglichen.
   Bei Erfolg: `localStorage.setItem('ajk_author_admin', '1')`.
4. Im Admin-Panel können Bücher (Titel, Genre, Klappentext/„hook", Status,
   Cover-URL oder Cover-Datei-Upload, Read/PDF-Link, Background-Link,
   Video-Link, Alt-Cover-Link) und Gedichte per Formular bearbeitet werden.
   `saveBook`/`addBook`/`removeBook` rufen jeweils `persistBooks()` auf.
5. `persistBooks()` schreibt **sofort in zwei Ziele**:
   - `localStorage` (`ajk_author_books_draft`) als Offline-Cache,
   - `POST` an `SCRIPT_URL` mit `action=saveBooks&books=<JSON>` — das ist
     der eigentliche, für alle Besucher sichtbare Speicherort.

**Wichtiger Befund:** Ein bereits gelistetes Buch fertigzustellen und live zu
schalten (Klappentext, Cover, Links, Status) **erfordert schon heute keinen
GitHub-Schritt** — Admin-Login, Felder ausfüllen, Speichern reicht, weil
Schritt 5 sofort global sichtbar wird (jeder Browser holt sich beim nächsten
Laden den aktuellen Stand über `action=getBooks`). Das Ziel aus dem Handoff
("ein Check reicht") ist für **bestehende** Bücher damit im Kern schon
erreicht. Ein GitHub-Push ist nur noch nötig für neue Seitenstruktur/Layout
oder als Sicherheits-/Backup-Aktualisierung des Seed-Snapshots.

---

## 3 · Wie ein Cover "über ein Google Sheet übersetzt" wird

Es gibt **keinen separaten Übersetzungsschritt** — die Vermutung im
Handoff war naheliegend, trifft aber nicht ganz zu:

- **Google Apps Script Web App** als einziges Backend:
  `https://script.google.com/macros/s/AKfycbwcbRDaWkM1wf3MV_dj4RPw9jQl2Fgc4YfGcmFrGU1S243yvh8WGW7mbyXLbSeVJKI/exec`
  Bekannte Endpunkte (aus dem Client-Code rekonstruiert, das Apps-Script
  selbst liegt **nicht** in diesem Repo und war für diese Session nicht
  einsehbar):
  - `GET ?action=getBooks` → `{ books: "<JSON-String>" }`
  - `GET ?action=list` → Bewertungen/Kommentare (Array oder `{rows:[...]}`)
  - `POST action=saveBooks&books=<JSON>` → schreibt den kompletten
    Bücher-Array vermutlich als eine Zelle/einen Wert in ein Google Sheet
  - `POST name=&itemType=&itemTitle=&stars=&comment=` (ohne `action`) →
    vermutlich Bewertung/Kommentar anhängen
- **Cover-Bild-Optionen für den Admin:**
  1. **URL einfügen** (z. B. Google-Drive-Freigabelink) — bevorzugter Weg,
     keine Größenbeschränkung.
  2. **Datei hochladen** — läuft komplett im Browser: Bild wird per
     `<canvas>` auf max. 220 px Breite verkleinert, als JPEG (Qualität 0.6,
     bei Bedarf 0.35) in einen Data-URL (Base64) umgewandelt und **hart auf
     45 000 Zeichen gedeckelt** (`window.alert(...)`, wenn auch verkleinert
     noch zu groß). Dieser Data-URL landet direkt als `coverUrl`-Feld im
     selben JSON, das per `saveBooks` an das Sheet geht — es gibt keine
     Bildablage, keinen CDN, kein separates Drive-Objekt für hochgeladene
     Cover.

**Konsequenz:** Hochgeladene Cover sind zwangsläufig sehr klein/komprimiert
(ok für eine Karten-Vorschau, nicht für Druck/hochauflösende Zwecke). Für
hochwertige Cover ist der Drive-Freigabelink der bessere Weg.

---

## 4 · Ist die Seite passwortgeschützt?

**Ja, aber nur ein Client-Side-Gate — kein echter Schutz.** Beide Passwörter
liegen **im Klartext** im ausgelieferten JavaScript:

```json
"settings": { "viewerPassword": "family2026", "adminPassword": "khan-admin-2026" }
```

Jede:r, die/der die Seite öffnet und "Seitenquelltext anzeigen" oder die
Browser-Entwicklertools nutzt, sieht beide Passwörter sofort im Klartext —
unabhängig vom eingegebenen Wert. Der Vergleich passiert vollständig im
Browser (`if (this.state.viewerPasswordInput === this.state.settings.viewerPassword)`),
nie auf einem Server. Für eine Seite, die auch unveröffentlichte Manuskripte
zeigen soll (mehrere Titel warten noch auf Verlagsrückmeldungen), ist das
ein reales Risiko, kein rein kosmetisches.

**→ Entscheidung (20.08.2026, mit dem Autor abgestimmt):** Wird zeitnah
behoben. Ein echter Fix verschiebt den Passwortvergleich auf das
Apps-Script-Backend (Passwort dort in Script Properties statt im Sheet oder
Client-Code; die Seite schickt nur noch das eingegebene Passwort per POST
und bekommt Erfolg/Misserfolg zurück, nie den Soll-Wert selbst).

**Blocker:** Diese Session hat **keinen Zugriff auf das Google-Apps-Script**
(kein Google-Drive/Apps-Script-Connector verbunden, siehe Handoff Abschnitt 2).
Um den Fix serverseitig umzusetzen, wird eines von beidem gebraucht:
- der Autor fügt der Apps-Script-Quelle einen von Claude Code vorbereiteten
  Codeblock manuell ein (script.google.com → Editor → Deploy), **oder**
- der Google-Drive/Apps-Script-Connector wird für diese Umgebung verbunden.

Bis dahin bleibt der Klartext-Zustand bestehen; siehe TODO unten.

---

## 5 · Datenmodell (aktueller Stand, 13 Bücher)

Pro Buch (`state.books[i]`):

| Feld | Zweck |
|---|---|
| `title` | Buchtitel |
| `kind` | Genre/Kategorie |
| `hook` | Klappentext/Kurzzusammenfassung (Teil-B-Backcover-Text) |
| `status` | Freitext-Status (z. B. „Fertig", „Fast fertig — …") |
| `coverUrl` | Bild-URL oder Base64-Data-URL (≤45 000 Zeichen) |
| `pdfUrl` | „Read"-Link (Leseprobe/Manuskript) |
| `bgUrl` | „Background"-Link (Hintergrundmaterial) |
| `videoUrl` | „Video"-Link (Intro-/Trailer-Video) |
| `altUrl` | „Alt. covers"-Link (ein Link zu mehreren Alt-Cover-Optionen, keine einzelnen Bilder inline) |

Kein Feld markiert ein Buch exklusiv als „Debütroman" — die in der
Constitution/Checkliste festgehaltene Regel (Debüt-Designation
projektübergreifend offen, bis Verlagsrückmeldungen vorliegen) wird vom
aktuellen Schema also nicht verletzt.

---

## 6 · Offene TODOs

1. **Passwort-Fix** (priorisiert) — braucht Apps-Script-Zugriff, siehe
   Abschnitt 4.
2. **Alt-Cover als echte Galerie statt Einzellink** — falls gewünscht,
   wäre das eine Schema-Erweiterung (`altCovers: []` statt `altUrl`).
3. **Cover-Upload-Limit (45 KB)** — falls hochauflösende Cover direkt über
   den Admin hochgeladen werden sollen, braucht es echte Bildablage
   (z. B. GitHub-Repo-Asset oder Drive-Upload-Flow statt Data-URL im Sheet).
