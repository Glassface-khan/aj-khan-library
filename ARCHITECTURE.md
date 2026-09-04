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

1. ~~Passwort-Fix~~ — erledigt, siehe Abschnitt 7.
2. **Alt-Cover als echte Galerie statt Einzellink** — falls gewünscht,
   wäre das eine Schema-Erweiterung (`altCovers: []` statt `altUrl`).
3. **Cover-Upload-Limit (45 KB)** — falls hochauflösende Cover direkt über
   den Admin hochgeladen werden sollen, braucht es echte Bildablage
   (z. B. GitHub-Repo-Asset oder Drive-Upload-Flow statt Data-URL im Sheet).
4. **Phase 2 (Inline-Reader)** — noch nicht gebaut, siehe Abschnitt 7.

---

## 7 · Nachtrag (21.08.2026) — was sich seit Abschnitt 1–6 geändert hat

Abschnitte 1–6 oben beschreiben den Stand vom 20.08.2026 (Klartext-
Passwörter, keine individuellen Zugänge). Seither:

- **Klartext-Passwörter entfernt.** `settings.viewerPassword`/
  `adminPassword` existieren im Client nicht mehr. Admin-Login prüft
  weiterhin ein einzelnes Passwort, aber serverseitig gegen
  `ADMIN_PASSWORD` in den Apps-Script Script Properties — nie im Code
  oder im ausgelieferten HTML.
- **Individuelle Zugangscodes statt geteiltem Viewer-Passwort.** Ein
  neuer `Access`-Sheet-Tab (`Name, Code, CanDownload, CanCopy`) ersetzt
  das alte `family2026`. Jede Person bekommt einen eigenen, im Admin-Panel
  generierten Code; `canDownload` steuert aktuell nur den "Read"-Link
  (öffentlicher PDF-/Drive-Link), `canCopy` ist vorbereitet, aber erst mit
  Phase 2 (Inline-Reader) wirksam.
- **Admin-Schreibzugriff (`saveBooks`, `addAccess`, `removeAccess`,
  `syncWordCount`) ist jetzt serverseitig geschützt**, nicht mehr nur ein
  Client-Flag. Admin-Login liefert ein Token, das der Client bei jeder
  Schreibaktion mitschickt; der Server prüft es gegen `PropertiesService`
  (mit eigener 24h-Ablauflogik). **Wichtig:** `CacheService` wurde für
  dieses Token bewusst *nicht* verwendet — in der Praxis unzuverlässig
  (Werte kamen nicht zurück, obwohl kurz zuvor gesetzt).
- **Wortzahl pro Buch** (`wordCount`-Feld) wird jetzt per Klick
  automatisch aus einem verlinkten Manuskript gezählt (`manuscriptDocUrl`-
  Feld, getrennt vom öffentlichen Read-Link), statt manuell eingetragen zu
  werden. Funktioniert zuverlässig bei nativen Google Docs; .docx wird
  automatisch in eine temporäre Google-Doc-Kopie umgewandelt (braucht die
  „Drive API" als aktivierten Advanced Service im Apps-Script-Projekt).
  PDF wird bewusst nicht unterstützt (unzuverlässige OCR) — Empfehlung:
  in Drive per „Öffnen mit → Google Docs" einmal manuell umwandeln.
- **Admin-Bereich:** Books- und Poems-Listen sind standardmäßig
  eingeklappt (mit Zähler in der Kopfzeile), wegen wachsender Buchanzahl.

### Apps-Script deployen — die eine Falle, die uns mehrfach erwischt hat

`Code.gs` speichern reicht **nicht**, damit die Live-Seite den neuen Code
nutzt. Nötig: **Deploy → Manage deployments → Stift-Symbol bei der
bestehenden Deployment-Zeile → Versions-Dropdown aktiv auf „New version"
umstellen → erst dann ist der „Deploy"-Button unten rechts anklickbar →
Deploy.** Wird das Dropdown nicht umgestellt, bleibt die Live-URL
stillschweigend auf der alten Version hängen — der Editor zeigt den neuen
Code, aber die Web-App führt ihn nie aus. Genau das ist beim Aufsetzen der
Zugangscodes mehrfach passiert und hat viel Fehlersuche gekostet, obwohl
der Code selbst korrekt war.

## 8 · Nachtrag (21.08.2026, Teil 2) — Poems-TOC & Zugangscode-Anzeige

- **Poems-Inhaltsübersicht sitzt jetzt an der richtigen Stelle.** Die
  bisherige statische "Part I–IV"-Vorschau am Kopf der Poems-Sektion war
  hartkodiertes HTML ohne jede Interaktivität — genau die Boxen, über die
  eigentlich gehovert wurde. Der separate "Inhalt"-Link neben Previous/
  Next (der tatsächlich funktionierte) war davon getrennt und wurde nicht
  gefunden. Fix: die Part-Vorschau wird jetzt aus den echten Gedichtdaten
  generiert (`poemTocParts`, gruppiert nach `poem.part`) und jede der vier
  Karten ist selbst der Hover(PC)/Tap(iOS)-Trigger, mit demselben weichen
  Übergangs-Rand (Schatten statt hartem Rahmen) wie zuvor konzipiert. Der
  alte separate Link entfällt, da redundant.
- **Zugangscode jetzt dauerhaft in der Zugänge-Liste sichtbar**, nicht
  nur im "gerade erstellt"-Banner direkt nach dem Anlegen. Rein
  client-seitige Änderung (der Code kam vom Server ohnehin schon mit),
  kein Apps-Script-Update nötig.

### Offen / vertagt

- **Bio- und Autorenfoto-Bearbeitung im Admin-Panel** — vom Nutzer
  bewusst vertagt ("hat Zeit"), aber nicht vergessen: Bio-Text wäre
  einfach (gleiches Muster wie Bücher/Poems-Edit). Das Autorenfoto ist
  aufwändiger, weil es aktuell ein eingebettetes Bundle-Asset ist
  (referenziert per UUID, z. B. `c04870d1-a8e6-411c-a8f3-b89cb24984e7`)
  und für Admin-Bearbeitung auf ein URL-/Upload-Feld umgestellt werden
  müsste, ähnlich wie Buch-Cover.
- **Google-Drive-Ordnerstruktur + Auto-Sync (volle Automatisierung
  gewünscht)** — größtes offenes Vorhaben. Geplantes Muster pro Buch:
  ```
  /AJ Khan Bücher/<Buchtitel>/
    /Manuskript/{DE,EN,BS,...}/   (nur Ordner für relevante Sprachen)
    /Intern/                       (Checkliste Teil 1 A)
    /Extern/                       (Checkliste Teil 1 B)
    /Bilder/{Cover,Alt-Cover}/
  ```
  Sprach-/Status-Erkennung über Dateinamens-Präfix (`ENTWURF_` = in
  Arbeit, `FINAL_` = fertig; fehlender Sprachordner = Sprache nicht
  relevant). Es gibt **keine** direkte Schnittstelle zwischen separaten
  Claude-Chats/Produkten — die Brücke zwischen einer Checklist-Review-
  Session und dieser Seite läuft zwangsläufig asynchron über Google
  Drive als Zwischenspeicher, wobei Apps Script das eigentliche Scannen/
  Reagieren übernimmt. Offene Design-Frage vor der Umsetzung: manueller
  "Sync jetzt"-Button pro Buch vs. echter zeitbasierter Apps-Script-
  Trigger (Nutzer wünscht "volle Automatisierung", was eher auf einen
  echten Zeit-Trigger hindeutet).

## 9 · Nachtrag (29.08.2026) — Stil-Revisions-Modul, Phase 2

Neuer Admin-Bereich **"Stil-Revision"** (siehe
`Claude_Code_Anweisung_Stil-Revisions-Modul.md` für die volle Anforderung).
Umgesetzt wurde bisher nur **Phase 2** (Datenmodell + Upload + Splitting +
Regelwerk-Verwaltung) — Revisions-Lauf-Engine, Cloud-Export und finaler
KI-Gegencheck (Phasen 3–6) sind bewusst noch nicht gebaut, wie vom Nutzer
selbst als phasenweises Vorgehen vorgegeben.

**Kollision mit der ursprünglichen Anforderung, angepasst statt unangekündigt
gebaut:** Die Anforderung ging von einem eigenen Backend mit SQLite/Postgres
aus. Es gibt aber (Abschnitt 2) kein eigenes Backend, nur GitHub Pages +
Google Apps Script. Lösung: das bestehende Apps-Script-Backend additiv
erweitert (`reference/apps-script/RevisionModule.gs`), keine Parallel-
Architektur. Neue Sheet-Tabs (`RevisionNovels`, `RevisionRulesets`,
`RevisionManuscripts`, plus vorbereitete leere Schemas für `RevisionRuns`/
`RevisionReviews`/`RevisionExports` für spätere Phasen) statt einer echten DB.
Volltexte (Regelwerk-Inhalt, Kapiteltexte) liegen als Dateien in einem neuen
Drive-Ordner `/AJ Khan Bücher/_StilRevision/...`, nicht in Sheet-Zellen — das
45 000-Zeichen-Zellenlimit aus Abschnitt 3 träfe bei ganzen Kapiteln sofort.

**Wie einbauen:** `reference/apps-script/RevisionModule.gs` ist NUR eine
Zusatzdatei — sie muss manuell im Apps-Script-Editor ergänzt und einmalig
`setupRevisionModule()` ausgeführt werden (legt Sheet-Tabs + Drive-Ordner an),
danach neu deployen (siehe die "New version"-Falle oben in Abschnitt 7). Sie
fasst `getBooks`/`saveBooks`/`checkPassword`/`addAccess`/`removeAccess`/
`syncWordCount` nicht an. Die eine Stelle, die der Nutzer beim Einfügen noch
per Hand anpassen muss, ist in der Datei mit "⚠ ANPASSEN" markiert: die
Admin-Token-Prüfung verweist testweise auf eine eigenständige
`PropertiesService`-Implementierung, weil diese Session **keinen Zugriff auf
das echte Code.gs hatte** (kein Apps-Script-Connector verbunden, wie schon in
Abschnitt 4 dokumentiert — ein Drive-Connector war zwar verfügbar, hat aber
das Skript-Projekt nicht als durchsuchbare Datei geliefert). Der Nutzer muss
diese eine Zeile durch den Aufruf seiner echten, bestehenden Token-Prüf-
Funktion ersetzen.

**Admin-UI:** neuer Abschnitt im Admin-Panel direkt nach "Zugänge", vor
"Sign out" — Roman anlegen/auswählen, Regelwerk (Freitext/Markdown + optionale
Straffungs-Zielkorridor-Notizen, global oder pro Roman, jede Speicherung
erzeugt eine neue Version statt zu überschreiben) und Manuskript-Upload mit
Kapitel-Splitting-Vorschau (eigene `###SECTION: Titel###`-Marker wie im
Referenzprototyp, sonst automatische mehrsprachige Überschriften-Erkennung;
manuelle Korrektur direkt in der Vorschau: Überschrift/Text bearbeiten,
Abschnitt mit dem vorherigen zusammenführen, oder per `###SPLIT###`-Marker im
Text an gewünschter Stelle teilen). `index.html` bleibt ein kompilierter
Claude-Design-Canvas-Export (`<x-dc>`-Template mit `sc-if`/`sc-for`/`{{ }}`-
Bindings + begleitender `text/x-dc`-Komponentenklasse mit `renderVals()` als
View-Model-Builder) — die neue Sektion folgt exakt diesem bestehenden Muster
(gleiche CSS-Variablen, gleiche fetch/URLSearchParams-Konvention wie
`fetchAccessList`/`addAccessPerson`), keine neue Template-Sprache eingeführt.

**Getestet vor dem Push:** Kopfloser Chromium-Testlauf (Playwright) hat
`index.html` unverändert gegen den Original-Stand gegengeprüft — mit
`isAdmin` clientseitig simuliert (localStorage) und jeder Request an die
Live-Apps-Script-URL abgefangen/gemockt, damit nichts an das echte Backend
ging. Ergebnis: bestehende Books-/Poems-/Zugänge-Bereiche rendern unverändert,
neuer Stil-Revision-Bereich rendert fehlerfrei, keine zusätzlichen
Konsolenfehler gegenüber dem unveränderten Original.

**Offen für die nächste Phase (erst nach Rückmeldung):** Revisions-Lauf-Engine
(sequenzieller Kapitel-Loop mit Pause/Fortsetzen, Claude-API-Proxy über
`PropertiesService`-Key, Vorher/Nachher-UI), Google-Drive-Export,
iCloud-Download-Export, finaler KI-Gegencheck mit Provider-Wahl
(Copilot-Verfügbarkeit als Drittanbieter-API vorab klären, Gemini als
realistischere Alternative zu Claude einplanen).

## 10 · Nachtrag (03.09.2026) — Drive-Sync mehrsprachig, Poems-Reihenfolge, Poems-Backend

- **Sprach-Umschalter für zweisprachige Bücher** (`book.langs`-Feld, EN|DE-
  Tabs auf der Buchkarte) + **"Jetzt aus Drive synchronisieren"-Button** im
  Admin-Panel (ruft `syncDriveForAllBooks()` sofort statt bis zu 1h auf den
  Zeit-Trigger zu warten). `syncDriveForAllBooks()` liest jetzt für **jede**
  `fertig`-Sprache (nicht nur eine "bevorzugte") Wortzahl + Klappentext ein
  und schreibt sie nach `b.langs[code]`; die alten Top-Level-Felder
  `b.wordCount`/`b.hook` bleiben zusätzlich gepflegt (abgeleitet aus
  `SYNC_PREFERRED_LANGUAGE`, sonst der einzigen/alphabetisch ersten fertigen
  Sprache) — rückwärtskompatibel für Bücher ohne Umschalter.
  **Wichtige Falle beim Debuggen live erlebt:** `ensureBookFolders()` legt
  nur die vier festen Hauptordner an (Manuskript, Intern, Extern, Bilder) —
  Sprachordner (z. B. `DE`) darin **nicht automatisch**, die legt der Autor
  selbst an. Und `findFileByPrefix()` prüft `FINAL_`/`KLAPPENTEXT_`
  **zeichengenau groß geschrieben** — `Final_...` oder `Klappentext_...`
  wird stillschweigend ignoriert (kein Fehler, einfach kein Treffer). Beide
  Punkte haben bei der Erstinbetriebnahme für ein Buch zu stundenlanger
  Fehlersuche geführt, obwohl der Code korrekt war.
- **Poems-Reihenfolge** (Part I–IV) ergibt sich aus der Reihenfolge der
  Einträge im `poems`-Array (Gruppierung nach erstem Auftreten von
  `poem.part`), nicht aus einem Sortierfeld — Part IV lag vor I–III, stabil
  nach Teilnummer sortiert.
- **Poems liegen jetzt auch serverseitig** in einem eigenen `PoemsData`-
  Sheet-Tab (exakt dasselbe Ein-Zeile-pro-Eintrag-Muster wie `BooksData`:
  Spalte A Titel, Spalte B JSON — aus demselben 50.000-Zeichen-Zellenlimit-
  Grund), über neue Aktionen `getPoems`/`savePoems` (`savePoems` admin-
  geschützt wie `saveBooks`). Vorher lag die Admin-Bearbeitung einzelner
  Gedichte nur in `localStorage` (`persist()`/`ajk_author_poems_draft`) —
  unsichtbar für andere Besucher/Geräte, verloren bei gelöschten
  Browserdaten. Jetzt: `fetchPoems()` beim Laden (analog `fetchBooks()`,
  überschreibt nie mit leerem Ergebnis — Seed/Cache bleiben Fallback, falls
  `PoemsData` noch leer ist), `persistPoems()` beim Speichern/Löschen eines
  Gedichts schickt die komplette Liste an `savePoems`. **Kein manueller
  Migrationsschritt nötig** — sobald einmal im Admin-Panel ein Gedicht
  gespeichert wird, schreibt das automatisch die komplette bestehende Liste
  ins neue Sheet (das Sheet ist bis dahin einfach leer, Website läuft in der
  Zwischenzeit unverändert vom eingebauten Seed weiter).
  **Getestet vor dem Push:** Playwright, Apps-Script-Aufrufe gemockt (wie in
  Abschnitt 9 beschrieben) — leeres `PoemsData` fällt korrekt auf den Seed
  zurück, gefülltes `PoemsData` überschreibt korrekt, ein simuliertes
  Bearbeiten+Speichern eines Gedichts im Admin-Panel löst genau einen
  `savePoems`-POST mit der vollständigen, korrekt aktualisierten Liste plus
  gültigem Admin-Token aus.
- **Nötiger manueller Schritt für den Nutzer:** Das erweiterte `Code.gs`
  (mit `getPoemsArray`/`setPoemsArray`/`getPoems`/`savePoems`) muss im
  Apps-Script-Editor eingefügt und **neu deployt** werden (siehe die "New
  version"-Falle in Abschnitt 7) — ohne das bleibt die Live-Web-App auf dem
  alten Code, `getPoems`/`savePoems` liefen dann ins Leere.
- **Handy/anderes Gerät zeigte kurzzeitig noch die alte Bücherliste** — beim
  Live-Debugging dieses Symptoms stellte sich heraus: Speichern (`saveBooks`)
  hatte korrekt funktioniert (BooksData-Sheet war bereits aktuell), auch die
  Freigabe-Einstellungen (Drive-Ordner "Anyone with the link", Apps-Script-
  Deployment "Who has access: Anyone") waren beide korrekt. Der direkte
  Aufruf der `?action=getBooks`-URL lieferte auf einem Gerät (Edge/Notebook)
  einen generischen Google-Fehler ("Datei kann derzeit nicht geöffnet
  werden"), auf einem anderen (Safari/iPhone) sofort die korrekten Daten —
  reine, einmalige Google-Infrastruktur-Aussetzer beim `script.google.com`-
  Weiterleitungsmechanismus, kein Code- oder Konfigurationsfehler. Ein
  harter Reload hat gereicht. Für künftige ähnliche Meldungen: zuerst
  `?action=getBooks` direkt in der Adresszeile des betroffenen Geräts
  aufrufen, um Server- von Konfigurations- von reinen Anzeige-/Cache-
  Problemen zu unterscheiden, bevor an den Einstellungen gedreht wird.

## 11 · Nachtrag (03.09.2026, Teil 2) — EPUB-Export pro Sprache

Automatischer EPUB-Export als Ergänzung zum bisherigen PDF-/Drive-Leselink —
liest sich auf Handy/iPad deutlich besser (verstellbare Schrift, echte
Kapitel-Navigation) als ein eingebetteter PDF-Viewer.

- **Läuft komplett automatisch im bestehenden Drive-Sync mit**, kein
  Zusatzklick: Sobald `syncDriveForAllBooks()` für eine fertige Sprache
  einen geänderten Manuskripttext feststellt (oder noch keine EPUB-URL
  hinterlegt ist), baut `buildEpub_()` daraus eine valide EPUB-3-Datei —
  komplett ohne externe Bibliothek, nur mit Apps Scripts eingebauter
  `Utilities.zip()`. Landet als `manuscript.epub` im jeweiligen
  Sprachordner (`Manuskript/<LANG>/`, überschreibt sich selbst bei jedem
  neuen Sync statt sich anzuhäufen), Link liegt in `b.langs[code].epubUrl`
  bzw. — abgeleitet von der bevorzugten Sprache, wie bei Wortzahl/
  Klappentext — zusätzlich in `b.epubUrl`.
- **Kapitel-Erkennung** (`splitIntoChapters_()`): sucht nach ganzen Zeilen,
  die auf gängige Kapitelüberschrift-Muster passen (Kapitel/Chapter/Teil/
  Part/Prolog/Epilog, optional mit Nummer). Findet sich keine einzige
  solche Zeile, bleibt das ganze Buch ein einziges durchlaufendes Kapitel
  (sicherer Fallback, funktioniert für jedes Manuskript, nur ohne
  Kapitel-Sprungmarken im Reader).
- **Design:** eigene Cover-Seite (nutzt dasselbe Titelbild wie die Website,
  `Bilder/Cover/`), schlichte Titelseite (Titel + "A. J. Khan"), Fließtext
  in Buchsatz-Optik (Serifenschrift, Erstzeilen ohne Einzug, Folgeabsätze
  mit Einzug, Blocksatz) — bewusst nur mit Systemschriften (kein
  Web-Font-Embedding, Lizenz-/Kompatibilitätsfragen vermieden).
- **Website:** neuer "EPUB"-Button direkt neben "Read" auf jeder Buchkarte
  (Einzelband wie Reihenbände), sprachabhängig wie Cover/Klappentext/
  Wortzahl beim Sprach-Umschalter — dieselbe `visitorCanDownload`-Zugriffs-
  prüfung wie beim bestehenden Read-Link, grau/inaktiv mit erklärendem
  Hinweis, solange keine EPUB-Datei hinterlegt ist.
- **Getestet vor dem Push:** Kapitel-Erkennung und XML-Erzeugung isoliert
  in Node nachgebaut (Apps-Script-`Utilities`-Aufrufe gemockt) und die
  erzeugten Dateien mit Pythons `xml.dom.minidom` auf Wohlgeformtheit
  sowie manuell auf vollständige Manifest-Referenzen geprüft — dabei einen
  echten Bug gefunden und behoben (Cover-Bild landete im Zip unter
  `images/…` statt `OEBPS/images/…`, passte nicht zur Manifest-Referenz).
  Danach die generierten Dateien zu einer echten `.epub` gepackt und mit
  der Python-Bibliothek `ebooklib` (unabhängiger dritter EPUB-Parser)
  eingelesen: Titel/Autor/Sprache/Spine/TOC/Cover-Bild-Bytes kommen korrekt
  an. Den neuen "EPUB"-Button zusätzlich per Playwright gegen gemockte
  Buchdaten geprüft (goldener Link bei vorhandener EPUB-URL, grau + Hinweis-
  Dialog ohne Navigation bei fehlender URL, kein zusätzlicher Konsolenfehler).
- **Offen:** Das erweiterte `Code.gs` muss wie bei den vorherigen
  Nachträgen manuell im Apps-Script-Editor eingefügt und neu deployt
  werden. Kapitel-Erkennung ist eine Heuristik ohne manuelle Korrektur-
  möglichkeit (anders als das separate Stil-Revisions-Modul) — bei
  Manuskripten ganz ohne erkennbare Kapitelüberschriften entsteht bewusst
  ein einziges durchlaufendes Kapitel statt eines Rate-Versuchs.

## 12 · Nachtrag (03.09.2026, Teil 3) — Background/Video-Auto-Sync, Genre-Erkennung,
## Bücher-Sichtbarkeit pro Zugangscode, EPUB erst ab Status "Fertig"

- **"Background"-Button** verlinkt jetzt automatisch den bisherigen
  `Extern`-Ordner (bisher nur Ablage ohne Website-Anbindung, hieß intern
  "Checkliste Teil 1 B"), sobald mindestens eine Datei drinliegt — bewusste
  Doppelnutzung dieses Ordners, vom Nutzer so gewünscht statt eines neuen
  eigenen Ordners.
- **"Video"-Button:** neuer eigener `Video`-Unterordner pro Buch (Top-
  Level, neben Manuskript/Intern/Extern/Bilder). Erste gefundene
  Videodatei (`video/…`-MIME-Typ) wird verlinkt — Drive-eigene Ansichtsseite
  (`/file/d/…/view`, spielt im eingebauten Player), nicht der Direkt-
  Download-Link wie bei EPUB.
- **Genre-Erkennung:** Datei mit Präfix `GENRE_` direkt im Buch-Wurzel-
  ordner (nicht pro Sprache, wie `KLAPPENTEXT_`/`FINAL_`) — erste Zeile
  des Dateiinhalts wird zum `kind`-Feld. Grund für eigene Datei statt
  Ableitung aus Ordnerstruktur: Genre ist freier Text ohne Signal, das
  sich sonst irgendwo in Drive ablesen ließe.
  **Nachtrag noch am selben Tag:** Der Nutzer hat einen separaten, bereits
  bestehenden Buch-Vorbereitungs-Workflow (Query Letter/Synopsis/
  Klappentext/Autor-Bio als B02/B03/B14/B07/…-nummerierte Dateien —
  passt exakt zur schon vorhandenen `KLAPPENTEXT_B14 Klappentext.md`-
  Namenskonvention) mit einer kanonischen `metadata.json` pro Buch
  (`genre.primary`/`genre.secondary`, `word_count`, `logline`, `keywords`,
  Dateiverweise). Genre-Erkennung liest jetzt **bevorzugt** diese
  `metadata.json` (falls im Buch-Wurzelordner vorhanden) —
  `genre.primary` + bis zu zwei `genre.secondary`-Einträge, z. B.
  "Politthriller · Dystopie, Gegenwartsliteratur" — die einfache
  `GENRE_`-Datei bleibt Fallback für Bücher ohne `metadata.json`.
  `docTextById()` um `application/json`-Mimetyp erweitert (wie
  `text/plain`/`text/markdown` behandelt). Weitere Felder aus
  `metadata.json` (Wortzahl, Logline als Klappentext, Kapitelstruktur)
  bewusst noch nicht angebunden — erst nach Rücksprache, da das mit den
  bestehenden `FINAL_`/`KLAPPENTEXT_`-Feldern kollidieren könnte
  (welche Quelle gewinnt im Konfliktfall).
- **EPUB erst ab Status "Fertig":** Der "EPUB"-Button wird erst aktiv,
  wenn `book.status` mit `"Fertig"` beginnt (Status ist Freitext, z. B.
  "Fertig (Submission-Materialien erstellt)" — `startsWith`, gleiches
  Muster wie das bestehende `mark`-Feld, das umgekehrt auf
  `"In Entwicklung"` prüft). Vorher bleibt nur "Read" (normaler Manuskript-
  Link) verfügbar, auch wenn im Hintergrund längst eine EPUB-Datei aus dem
  FINAL_-Manuskript erzeugt wurde — die Datei liegt bereit, wird aber erst
  verlinkt, sobald der Autor den Status manuell umstellt.
- **Bücher-Sichtbarkeit pro Zugangscode:** Jeder individuelle Zugang
  (Access-Sheet, bisher Name/Code/CanDownload/CanCopy) hat jetzt eine
  fünfte Spalte `VisibleBooks` — leer/fehlt = alle Bücher sichtbar
  (Standard, rückwärtskompatibel zu alle bisherigen Zugängen), sonst
  JSON-Array erlaubter Buchtitel. Neue Aktion `setAccessVisibleBooks`
  ändert das nachträglich für einen bestehenden Code, ohne ihn neu zu
  erzeugen (der ja schon weitergegeben sein kann) — Admin-Panel hat dafür
  pro Zugang einen "Bücher"-Button, der eine Checkliste aller aktuellen
  Buchtitel öffnet. Beim Anlegen eines neuen Zugangs ist dieselbe
  Checkliste direkt mit dabei. Gefiltert wird rein clientseitig beim
  Rendern der öffentlichen Bücherliste (`visitorVisibleBooks` aus
  `checkAccess`, im selben `ajk_visitor_access`-localStorage-Objekt wie
  Name/canDownload/canCopy gecacht) — **kein** serverseitiger Schutz, ein
  technisch versierter Besucher könnte über die rohe `?action=getBooks`-
  URL trotzdem alle Bücher sehen. Für den Anwendungsfall (Familie/Freunde
  bekommen einen Überblick, keine Bücher, die sie (noch) nicht lesen
  sollen) ausreichend, aber kein Zugriffsschutz im eigentlichen Sinne.
  Admin sieht beim Verwalten der Seite immer alle Bücher, unabhängig von
  einem eventuell selbst eingegebenen Gast-Zugangscode.
- **Getestet vor dem Push:** Playwright mit gemockten Apps-Script-
  Antworten — Gast mit `visibleBooks: ['Buch A']` sieht nur Buch A, Admin
  sieht trotz gleicher Einschränkung im localStorage alles; EPUB-Button
  golden bei Status "Fertig" + vorhandener URL, grau + korrekter Hinweis-
  Dialog bei "In Entwicklung" trotz vorhandener EPUB-URL (Status- und
  URL-Gate isoliert geprüft); neuen Zugang mit Bücher-Einschränkung
  anlegen löst `addAccess`-POST mit korrektem `visibleBooks`-JSON aus;
  bestehenden Zugang nachträglich einschränken (Checkliste öffnen, "Alle
  Bücher sichtbar" abwählen, einzelnes Buch ankreuzen, Speichern) löst
  `setAccessVisibleBooks`-POST mit korrektem Code + Buchliste aus. Keine
  Konsolenfehler in allen Szenarien.
- **Nötiger manueller Schritt:** Wie immer — erweitertes `Code.gs`
  einfügen und neu deployen.

**Für später vom Nutzer vorgemerkt (noch nicht gebaut, erst nach Rücksprache):**
Weitere Felder aus `metadata.json` automatisch übernehmen — `word_count`
(Wortzahl), `logline` (als Klappentext/`hook`), Kapitelstruktur
(`chapter_count`/`structure_parts`). Nicht einfach gebaut, weil das mit
den bestehenden `FINAL_`/`KLAPPENTEXT_`-Feldern kollidieren könnte —
zuerst klären, welche Quelle im Konfliktfall gewinnt, wenn ein Buch
sowohl eine `metadata.json` als auch `FINAL_`/`KLAPPENTEXT_`-Dateien hat.

**Ebenfalls für später vorgemerkt: KI-Genre-Erkennung.** Bei neuen
Manuskripten ohne `metadata.json`/`GENRE_`-Datei automatisch einen
Textausschnitt an eine KI (z. B. Claude-API) schicken und daraus einen
Genre-Erstvorschlag ableiten lassen — als Startpunkt, jederzeit vom Autor
überschreibbar (z. B. durch eine später nachgereichte `metadata.json` mit
sorgfältig recherchierten Amazon-Kategorien/Comp-Titeln, die dann Vorrang
hätte). Braucht einen API-Schlüssel (Kosten pro Aufruf, aber gering) und
eine `UrlFetchApp`-Anbindung an die Claude-API aus `Code.gs` heraus —
noch nicht gebaut, Nutzer möchte erst die einfacheren Datei-basierten
Wege (`metadata.json`/`GENRE_`) nutzen.

## 13 · Nachtrag (04.09.2026) — Bücher-Reihenfolge im Admin-Panel

Anzeige-Reihenfolge auf der öffentlichen Seite entspricht der Reihenfolge
im `books`-Array (Mehrteiler werden dabei an der Position ihres ersten
Bandes zu einem Regal-Block gruppiert, siehe `bookDisplayItems`-Logik).
Bisher gab es keine Möglichkeit, diese Reihenfolge nachträglich zu ändern
außer über Löschen/Neuanlegen. Neu: pro Buch im Admin-Panel zwei Buttons
(↑/↓) neben Edit/Delete — vertauschen die Position mit dem Nachbarn im
`books`-Array (`moveBookUp`/`moveBookDown`, analog zu `removeBook`: State-
Update gefolgt von `persistBooks()`) und sind am jeweiligen Rand
(`isFirst`/`isLast`) über das bestehende `disabled="{{ ... }}"`-Muster
deaktiviert. Wirkt sich nur auf die Reihenfolge aus, nicht auf die
Bandnummer/Reihen-Zugehörigkeit selbst — die Position innerhalb einer
gruppierten Reihe folgt weiterhin der Array-Reihenfolge, nicht der
`seriesNumber` (unverändert gegenüber Abschnitt 12).

## 14 · Nachtrag (04.09.2026) — Gedichte (Heartfelt) pro Zugangscode ein-/ausblendbar

Gleiches Muster wie `VisibleBooks` (Abschnitt 12), nur als einzelner
Schalter statt einer Buchliste, weil es nur eine Gedichtsammlung gibt.
Neu im Access-Datensatz: `showPoems` (Default `true`, rückwärtskompatibel
zu allen bisherigen Zugängen ohne dieses Feld). Checkbox „Gedichte
(Heartfelt) sichtbar" sowohl beim Anlegen eines neuen Zugangs als auch
beim nachträglichen Bearbeiten (`editAccessBooks`/`saveAccessBooks`,
gleicher Dialog wie die Bücher-Sichtbarkeits-Checkliste). Die öffentliche
`<section id="poems">` ist jetzt in `<sc-if value="{{ showPoemsSection }}">`
gehüllt — `showPoemsSection` ist `true` für Admins und für Besucher mit
`visitorShowPoems !== false`.

**Offen — Backend (`Code.gs`, nicht in diesem Repo, manuell im Apps-
Script-Editor nachzuziehen):**
- `checkAccess`: Antwort um `showPoems: <Wert aus Access-Sheet>` erweitern
  (analog zu `visibleBooks`).
- `addAccess`: neuen Parameter `showPoems` (`'true'`/`'false'`-String)
  entgegennehmen und in eine neue Access-Sheet-Spalte `ShowPoems`
  schreiben (Default `TRUE`, wie bei `VisibleBooks` leer = alle sichtbar).
- `updateAccess`: ebenfalls `showPoems`-Parameter entgegennehmen und die
  `ShowPoems`-Spalte des bestehenden Zugangs aktualisieren.
- Zeilen ohne `ShowPoems`-Wert (alle bisherigen Zugänge) müssen als
  „sichtbar" gelten (leer/fehlt → `true`), exakt das gleiche
  Rückwärtskompatibilitäts-Muster wie bei `VisibleBooks`.

Bis dieser Backend-Teil eingefügt und neu deployt ist, wirkt der neue
Schalter im Admin-Panel optisch, aber ohne Effekt (Server ignoriert den
zusätzlichen Parameter, `showPoems` kommt bei `checkAccess` nicht zurück
→ `visitorShowPoems` bleibt bei `true`, Gedichte bleiben für alle
sichtbar — sicherer Fallback, kein versehentliches Verstecken).
