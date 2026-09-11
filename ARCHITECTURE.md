# Architektur der Autorenseite (aj-khan-library)

*Rekonstruiert aus dem tatsächlichen `index.html` im Repo, nicht aus der im Handoff erwähnten ZIP (die im neuen Chat nicht mit hochgeladen wurde). Stand: 20. August 2026.*

Dieses Dokument klärt die vier offenen Fragen aus dem Handoff-Dokument
(„Was die ZIP beim Öffnen klären soll") und hält die Architekturentscheidung
fest, die als Ergebnis dieser Analyse getroffen wurde.

---

## 0 · Aktueller Stand (Kurzfassung, Stand 09.09.2026)

**Für eine neue Chat-Session zum schnellen Reinkommen — Details/Begründungen
in den chronologischen Nachträgen unten (Abschnitte 1–19).**

**Architektur:** `index.html` ist ein kompilierter Claude-Design-Canvas-
Export (Bundler-Format, siehe Abschnitt 1) — **dieses Repo ist seit
20.08.2026 die Source of Truth**, nicht mehr Claude Design. Backend ist ein
Google-Apps-Script-Web-App (`Code.gs`) — **liegt NICHT in diesem Repo**,
lebt nur im Apps-Script-Editor im Google-Konto des Autors. Jede Backend-
Änderung muss der Autor manuell einfügen (kompletten Dateiinhalt ersetzen,
nicht einzelne Schnipsel) und deployen (**„New version"-Falle**, siehe
Abschnitt 7 — sonst merkt die Live-URL den neuen Code nicht).

**Was aktuell alles funktioniert (öffentliche Seite):**
- Bücher- und Gedichte-Anzeige, Bewertungen/Kommentare.
- Individuelle Zugangscodes (Access-Sheet) mit granularen Rechten pro
  Zugang: welche Bücher sichtbar (`VisibleBooks`), Gedichte/Heartfelt an
  oder aus (`ShowPoems`), und — neu — pro **fertigem** Buch einzeln
  „Lesen"/„Downloaden" (`EpubAccess`, Abschnitt 17). Voller Zugriff
  (`CanDownload=true`) übersteuert alles, unabhängig vom Buchstatus.
- Nutzer *ohne* vollen Zugriff kommen an **keiner** Stelle mehr auf einen
  rohen Google-Drive-Link (weder Manuskript-Doc noch Background/Video/
  Alt-Cover-Ordner) — Abschnitt 17.
- Alt-Cover-Galerie **inline** auf der Seite (Lightbox), nicht mehr
  Weiterleitung zu Drive (Abschnitt 15).
- **Inline-EPUB-Reader** (epub.js) für fertige Bücher — öffnet sich beim
  „Read"-Klick statt zu Drive zu verlinken (Abschnitt 16), inkl.
  **Lese-Bookmark** pro Gerät/Browser (Abschnitt 19, kein Cross-Device-
  Sync).
- Admin-Panel: Bücher-Reihenfolge per ↑/↓ änderbar (Abschnitt 13),
  Zugangscode-Verwaltung inkl. aller obigen Rechte.
- Automatischer stündlicher Drive-Sync (`syncDriveForAllBooks`): Cover,
  Wortzahl, Klappentext pro Sprache, EPUB-Bau, Genre aus `metadata.json`/
  `GENRE_`-Datei, Alt-Cover-Bilder, Background-/Video-Links.

**Offene TODOs (nicht gebaut, teils bewusst zurückgestellt):**
- Weitere `metadata.json`-Felder automatisch übernehmen (Wortzahl,
  Logline, Kapitelstruktur) — Konfliktfrage mit `FINAL_`/`KLAPPENTEXT_`
  ungeklärt (Abschnitt 12).
- KI-Genre-Erkennung als Erstvorschlag (Abschnitt 12).
- Bio- und Autorenfoto-Bearbeitung im Admin-Panel (Abschnitt 8).
- Google-Drive-Ordnerstruktur + volle Auto-Sync-Automatisierung — größtes
  ursprünglich offenes Vorhaben (Abschnitt 8), inzwischen aber größtenteils
  durch `syncDriveForAllBooks` erledigt; offene Detailfrage war „Sync
  jetzt"-Button vs. reiner Zeit-Trigger — aktuell nur Zeit-Trigger.
- Stil-Revisions-Modul Phasen 3–6 (Revisions-Lauf-Engine, Cloud-Export,
  KI-Gegencheck) — nur Phase 2 gebaut (Abschnitt 9).
- Geräteübergreifender Sync des Lese-Bookmarks (Abschnitt 19) — aktuell
  bewusst nur lokal pro Gerät.
- Alt-Cover als echte Galerie: **erledigt** (Abschnitt 15, war früher TODO
  #2 in Abschnitt 6).
- Cover-Upload-Limit (45 000 Zeichen) für hochauflösende Cover — noch offen.

**Gelernte Fallstricke dieser Session (fürs nächste Mal):**
- Mobiles Kopieren/Einfügen sehr langer `Code.gs`-Dateien kann
  unbemerkt Teile verlieren (→ „unknown action"-Fehler bei eigentlich
  längst existierenden Aktionen). Nach dem Einfügen: Zeilenzahl und
  Dateiende prüfen, bevor deployt wird.
- `index.html` ist eine ~9-MB-Datei mit dem gesamten Seiteninhalt als ein
  einziger, escapter JSON-String in einer Zeile — direkte Text-Edits nur
  über gezielte, verifizierte String-Ersetzungen (nie freihändig tippen),
  danach immer: JSON-Parse der Zeile + `node --check` der extrahierten
  Component-Klasse + Tag-Balance-Check, bevor gepusht wird.

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

**Backend erledigt (04.09.2026), `Code.gs` (nicht in diesem Repo, lebt im
Apps-Script-Editor):** Nutzer hat den kompletten Datei-Inhalt hier im Chat
geteilt (mobil per Command-Palette-„Select All"-Workaround kopiert, siehe
Chat-Verlauf — normales Markieren/Kopieren im Apps-Script-Mobile-Editor
funktioniert nicht zuverlässig). Claude hat daraus eine vollständige neue
Datei erzeugt (gezielte Ergänzung an 5 Stellen, per Diff gegen das
Original geprüft, nichts Bestehendes verändert) und als fertige Datei
zurückgegeben — Nutzer musste nur die ganze Datei ersetzen, nicht einzelne
Schnipsel von Hand einfügen. Die 5 Ergänzungen:
- Neue Hilfsfunktion `parseShowPoems_` (Default `true` bei leerer Zelle —
  gleiches Rückwärtskompatibilitäts-Muster wie `parseVisibleBooks_`, nur
  mit umgekehrtem Default, weil hier "leer" = sichtbar statt "leer" = alle
  Bücher).
- `checkAccess` liefert jetzt `showPoems: parseShowPoems_(rows[i][5])` mit.
- `getAccessList` liefert `showPoems` ebenfalls pro Zugang mit.
- `addAccess` legt beim ersten Anlegen die 6. Access-Sheet-Spalte
  `ShowPoems` an und schreibt den Wert.
- `updateAccess` schreibt die `ShowPoems`-Spalte beim nachträglichen
  Bearbeiten eines bestehenden Zugangs mit (Range-Schreibweite von 3 auf 4
  Spalten erweitert).

Vom Nutzer deployt (04.09.2026) — Funktion ist live.

## 15 · Nachtrag (04.09.2026) — Alt-Cover-Galerie inline statt Drive-Weiterleitung

Erster Teil der beiden im Chat besprochenen "keine Drive-Weiterleitung
mehr"-Wünsche (TODO 2 aus Abschnitt 6); der Inline-EPUB-Reader (zweiter
Teil, deutlich größer) folgt danach.

**Frontend:** Der bestehende "Alt. covers"-Button (`<a href="{{ item.altUrl
}}">`, sowohl in der Einzelbuch- als auch in der Buchreihen-Kartenvorlage)
bleibt strukturell unverändert — kein Template-Umbau nötig. Stattdessen
öffnet `onAlt` jetzt, falls `b.altCovers` (neues Array-Feld) Bilder enthält,
per `e.preventDefault()` + `this.openAltGallery(b.altCovers, b.title)` eine
neue Lightbox (State: `altGalleryImages`/`altGalleryIndex`/
`altGalleryTitle`; Methoden `openAltGallery`/`closeAltGallery`/
`nextAltCover`/`prevAltCover`) statt zum Drive-Ordner zu verlinken.
`altUrl` (der alte Ordner-Link) bleibt als Fallback bestehen, solange ein
Buch noch keine `altCovers` hat (z. B. direkt nach Anlegen, vor dem
nächsten stündlichen Drive-Sync) — kein Bruch für Bücher im Übergang.
Lightbox-Modal (neuer `<sc-if value="{{ showAltGallery }}">`-Block direkt
neben dem bestehenden Admin-Login-Modal) zeigt ein Bild groß, mit
Zurück/Weiter bei mehreren Bildern und Zähler ("Buchtitel — 2 / 5").

**Backend (`Code.gs`):** Neue Hilfsfunktion `allImageFiles_` (Gegenstück
zu `firstImageFile`, sammelt alle statt nur das neueste Bild eines
Ordners, sortiert nach Alter für stabile Reihenfolge). Im Alt-Cover-Block
von `syncDriveForAllBooks` wird jetzt zusätzlich zum Ordner-Link
`b.altCovers` befüllt — ein Array einzelner Bild-URLs über dieselbe
`publicViewUrlFor`-Funktion (lh3.googleusercontent.com-CDN-Links), die
auch für das normale Buch-Cover verwendet wird. Rebuild nur bei
tatsächlicher Änderung (Array-Vergleich per `.join('|')`), damit nicht bei
jedem stündlichen Sync unnötig `changed = true` gesetzt wird.

## 16 · Nachtrag (04.09.2026) — Inline-EPUB-Reader statt Drive-Weiterleitung

Zweiter und größerer Teil der "keine Drive-Weiterleitung mehr"-Wünsche
(TODO 4/Phase 2 aus Abschnitt 6) — nur für fertige Bücher mit vorhandenem
EPUB (Status startsWith "Fertig" + `epubUrl` gesetzt); Admin kann wie
gewohnt weiterhin direkt über Drive lesen, das war nie eingeschränkt.

**Bibliothek:** [epub.js](https://github.com/futurepress/epub.js) (+ jszip
als Absicherung, falls der epub.js-Build es nicht selbst mitbringt) — per
`<script src="…jsdelivr…">` **im echten, unverpackten `<head>`** der Seite
geladen (vor `</head>`, Zeile ~26–29), nicht irgendwo im kompilierten
Bundle-String weiter unten. Grund: die komplette App-HTML (inkl. der
`<script type="text/x-dc">` mit der Component-Klasse) wird zur Laufzeit als
ein großer String entpackt und eingefügt — ein `<script src="…">`, das
darin stünde, würde vom Browser beim Einfügen nicht ausgeführt (Browser
führen per `innerHTML` eingefügte `<script>`-Tags nicht aus). Im echten
`<head>` geladen läuft es dagegen ganz normal beim ersten Seitenaufruf,
lange bevor die App überhaupt mountet, und steht als globales `ePub` sicher
bereit, wenn die App später darauf zugreift.

**Frontend:** `onOpen` (der "Read"-Button) öffnet jetzt für fertige Bücher
mit EPUB (`bookIsFinished && effEpubUrl && typeof ePub !== 'undefined'`)
einen neuen Vollbild-Reader (State: `readerOpen`/`readerBookTitle`/
`readerLoading`/`readerError`; Methoden `openReader`/`mountEpubReader`/
`closeReader`) statt zum `pdfUrl`-Link zu springen. Bücher ohne EPUB
(Status "In Entwicklung") bleiben unverändert beim direkten Link. Fällt
`ePub` aus irgendeinem Grund aus (CDN blockiert, Skript nicht geladen),
greift automatisch der alte Direktlink als Fallback — kein kaputter Button.
Reader-Modal zeigt einen leeren `<div id="epub-reader-viewport">`, sobald
`readerOpen` true wird (schon während des Ladens, damit `epub.js` beim
späteren `renderTo()`-Aufruf garantiert ein existierendes DOM-Element
vorfindet), mit Lade-/Fehleranzeige als Overlay darüber. Lesemodus
`scrolled-doc` (durchlaufendes Scrollen statt Seiten-Umblättern) für einen
einfachen, robusten ersten Wurf.

**Backend (`Code.gs`):** Neue Aktion `getEpubData` — nimmt die `epubUrl`
entgegen, extrahiert die Drive-Datei-ID (gleiches Regex-Muster wie bei
`syncWordCount`), prüft die ID gegen die tatsächlich in `getBooksArray()`
hinterlegten `epubUrl`-Werte (Top-Level und pro Sprache in `b.langs`) und
liefert bei Treffer die rohen Datei-Bytes Base64-codiert zurück. Kein
Admin-Token nötig (öffentlicher Lese-Endpunkt wie `getBooks`) — die
ID-Prüfung ist die einzige Schranke, verhindert aber immerhin, dass der
Endpunkt als beliebiger Drive-Datei-Oracle missbraucht werden könnte, statt
nur tatsächlich verlinkte EPUBs auszuliefern. Grund für den Umweg über den
Server statt direktem Browser-Fetch auf den Drive-Link: Cross-Origin-
`fetch()` auf `drive.google.com`-Download-Links scheitert in der Praxis an
CORS; der Apps-Script-Endpunkt funktioniert zuverlässig, weil die Seite
ihn ohnehin schon für alle anderen Aktionen benutzt.

**Nicht getestet — noch offen:** Diese Session hatte keinen Zugriff auf
das echte Backend/eine echte EPUB-Datei, konnte den Reader also nicht live
durchklicken. Insbesondere unklar/zu prüfen: ob die gepinnte epub.js-
Version (`0.3.93`) über den CDN-Link tatsächlich lädt, ob `dist/epub.min.js`
JSZip wirklich mitbringt oder das separat geladene `jszip.min.js` greifen
muss, und ob sehr große EPUB-Dateien (viele Bilder) an Apps-Script-
Antwortgrößenlimits stoßen. Nutzer testet nach Backend-Deploy live an
einem echten fertigen Buch mit EPUB.

## 17 · Nachtrag (04.09.2026) — Feingranulare EPUB-Rechte pro Zugang + Drive komplett gesperrt für Nutzer ohne vollen Zugriff

Nutzer-Feedback nach Abschnitt 16: Der volle Lesezugriff (`canDownload`)
sollte weiterhin bedingungslos alles erlauben (Read + EPUB, unabhängig vom
Buchstatus — das war schon immer so, siehe Abschnitt 5/12). Aber Nutzer
*ohne* vollen Lesezugriff sollen (a) pro einzelnem **fertigen** Buch
gezielt zum Lesen und/oder Downloaden freigeschaltet werden können, und
(b) grundsätzlich **keine** Möglichkeit mehr haben, auf rohe Drive-Links
zu stoßen (weder Manuskript-Dokumente noch Background/Video/Alt-Cover-
Ordner) — konsequent, nicht nur für EPUB.

**Neues Datenfeld pro Zugang: `epubAccess`** — `{ "Buchtitel": { read:
bool, download: bool } }`. Anders als `visibleBooks`/`showPoems` ist der
Default hier bewusst **"kein Zugriff"**, nicht "alles erlaubt" — das soll
eine gezielte, positive Freigabe pro Buch sein, kein nachträglich
abschaltbares Feature. Nur relevant für Zugänge mit `canDownload=false`;
bei `canDownload=true` komplett irrelevant (der darf ohnehin alles, wie
bisher).

**Frontend-Zugriffslogik (public-facing), Nutzer ohne `canDownload`:**
- **Read** (`onOpen`): nur für fertige Bücher mit EPUB **und** `epubAccess[titel].read` — öffnet dann den Inline-Reader wie in Abschnitt 16. Sonst Hinweis „kein Lesezugriff", **kein** Fallback auf den rohen `pdfUrl`-Link (der für unfertige Bücher ein Google-Doc-Link wäre) — Nutzer ohne vollen Zugriff kommen für nicht freigegebene/unfertige Bücher grundsätzlich nicht mehr auf Drive.
- **EPUB-Button** (`onEpub`): nur bei `epubAccess[titel].download` — löst jetzt `downloadEpub()` aus (siehe unten), **kein** direkter Drive-Link mehr für diese Nutzergruppe (war vorher schon `href="#"`, aber der Button war komplett wirkungslos statt einen echten Download anzustoßen).
- **Background/Video** (`onBg`/`onVideo`): komplett gesperrt (`e.preventDefault()` + Hinweis) für `canDownload=false`, unabhängig von `epubAccess` — dafür gibt's keine granulare Freigabe, nur an/aus über den vollen Zugriff.
- **Alt-Cover** (`onAlt`): Inline-Galerie (`altCovers`, Abschnitt 15) bleibt für alle verfügbar (kein Drive-Redirect) — nur der alte **Fallback-Link** auf den Drive-Ordner (bei Büchern ohne `altCovers`) ist jetzt ebenfalls auf `canDownload` beschränkt.
- **Neue `hrefs`** (`bgHref`/`videoHref`/`altHref`) ersetzen die bisher rohen `b.bgUrl`/`b.videoUrl`/`b.altUrl` als `href`-Attribut — vorher stand die echte Drive-URL immer im `href`, auch wenn der Klick-Handler blockierte; das genügte zwar für normales Klicken, aber ein Mittelklick/Strg-Klick ("In neuem Tab öffnen") umgeht `onClick`/`preventDefault()` und wäre trotzdem zu Drive durchgekommen. Jetzt liefert der `href` selbst schon `'#'`, wenn kein voller Zugriff besteht.

**`downloadEpub()`** (neue Methode): holt die EPUB-Bytes über denselben
`getEpubData`-Endpunkt (mit `intent:'download'`), baut daraus einen
`Blob` und stößt den Download über ein unsichtbares `<a download>`-Element
an — kein direkter (öffentlich freigegebener) Drive-Link wird dem Browser
je bekannt gemacht.

**Backend (`Code.gs`):**
- Neue Hilfsfunktion `parseEpubAccess_` (Default `{}`, siehe oben).
- `checkAccess`/`getAccessList`: liefern `epubAccess` aus Spalte 7 (`EpubAccess`) mit.
- `addAccess`/`updateAccess`: legen/schreiben die neue Spalte.
- `getEpubData` **jetzt mit echter serverseitiger Berechtigungsprüfung**
  statt reinem Client-Vertrauen: nimmt zusätzlich `code`, `bookTitle`,
  `intent` (`read`/`download`) entgegen, schlägt den Zugang im Access-Sheet
  nach (`canDownload` + `epubAccess`) und lehnt ab, wenn weder voller
  Zugriff noch die passende Buch-Freigabe vorliegt — **bevor** überhaupt
  Datei-Bytes gelesen werden. Der bestehende Datei-ID-Abgleich gegen
  bekannte EPUB-URLs (Abschnitt 16) bleibt zusätzlich bestehen.

**Ehrliche Grenze dieser Absicherung:** Die zugrunde liegenden Drive-
Dateien/Ordner sind weiterhin technisch „jeder mit Link" freigegeben
(nötig, damit `DriveApp`/die Website überhaupt zugreifen kann) — wer die
rohe Drive-URL direkt kennt (z. B. weil sie ihm mal zugespielt wurde),
kommt an ihr vorbei an den Dateien, unabhängig von `epubAccess`. Das
betrifft **ausschließlich EPUB-Dateien**, die jetzt über den Server-Umweg
laufen — Background/Video/Alt-Cover-Ordner bleiben, wie im gesamten
Projekt an mehreren Stellen dokumentiert (Abschnitt 12/16), reine UI-Ebene-
Absicherung ohne kryptographische Garantie. Für den Anwendungsfall
(Familie/Freunde, keine feindliche Bedrohungslage) ist das der bewusst
gewählte, im Projekt durchgängige Kompromiss.

**Admin-Panel:** Neuer Abschnitt „EPUB-Zugriff pro fertigem Buch" (nur
Bücher mit Status „Fertig…") sowohl beim Anlegen eines neuen Zugangs als
auch beim nachträglichen Bearbeiten — zwei Checkboxen „Lesen"/„Downloaden"
pro Buch, mit Hinweis, dass das wirkungslos ist, solange „Darf
herunterladen" oben aktiviert ist.

**Nicht getestet:** Wie bei Abschnitt 16 kein Zugriff auf echtes
Backend/echte Zugänge in dieser Session — nur Syntax/Struktur-Checks
möglich. Nutzer testet nach Backend-Deploy live mit einem Zugang ohne
`canDownload`.

## 18 · Nachtrag (05.09.2026) — Fix: Inline-Reader zeigte nur das Cover

Nutzer-Test nach Abschnitt 16/17: Der Reader öffnete sich, zeigte aber nur
das EPUB-Cover-Bild und keinen Fließtext. Ursache: `buildEpub_()` setzt bei
vorhandenem Cover die Cover-Seite als **erstes** Spine-Element (vor
Titelseite und Kapiteln). `book.renderTo(...)` lief mit
`flow: 'scrolled-doc'`, aber **ohne** `manager: 'continuous'` — epub.js'
Standard-Manager rendert dabei nur ein Spine-Element auf einmal und
bräuchte explizite `.next()`-Aufrufe (z. B. über eine Seiten-Navigation),
um zum nächsten zu wechseln; die gibt es hier nicht. Ergebnis: der Reader
blieb dauerhaft auf der Cover-Seite stehen.

**Fix:** `manager: 'continuous'` zur `renderTo()`-Konfiguration ergänzt —
lässt epub.js alle Spine-Elemente (Cover → Titelseite → Kapitel) als ein
einziges durchlaufendes Dokument rendern, genau wie ursprünglich mit
"scrolled-doc" beabsichtigt.

## 19 · Nachtrag (09.09.2026) — Lese-Bookmark im Inline-Reader

Nutzer-Wunsch: Beim erneuten Öffnen eines Buchs im Inline-Reader soll die
Leseposition erhalten bleiben statt jedes Mal von vorn zu beginnen.

**Bewusst ohne Backend-Änderung umgesetzt** — die Position wird im
`localStorage` des jeweiligen Geräts/Browsers gespeichert
(`ajk_epub_bookmark_<epubUrl>`, eindeutig pro Datei, unterscheidet damit
automatisch auch zwischen Sprachfassungen eines Buchs). Kein neues
Sheet-Feld, kein Redeploy nötig.

- `epub.js` liefert über CFIs (Canonical Fragment Identifiers) eine
  stabile Positions-Referenz. Das `relocated`-Event der Rendition (feuert
  bei jedem Positionswechsel, auch beim Scrollen im `continuous`-Manager
  aus Abschnitt 18) schreibt die aktuelle CFI laufend in den
  `localStorage`.
- Beim Öffnen (`mountEpubReader`) wird die gespeicherte CFI gelesen und
  direkt an `rendition.display(cfi)` übergeben statt an den Buchanfang zu
  springen. Schlägt das fehl (z. B. weil sich die EPUB-Struktur seither
  geändert hat, ungültige CFI), fängt ein `.catch()` das ab und springt
  stattdessen sicher an den Anfang — kein kaputter Reader.

**Bewusste Grenze:** Das ist **pro Gerät/Browser**, nicht geräteübergreifend
synchronisiert — wer auf dem Handy und später am Laptop weiterliest, hat
dort jeweils eigene Bookmarks. Für einen wirklich geräteübergreifenden
Bookmark bräuchte es ein neues Backend-Feld (z. B. pro Zugangscode +
Buchtitel in einer neuen Sheet-Spalte oder einem eigenen Tab) — bewusst
nicht gebaut, da nicht angefragt; bei Bedarf später nachrüstbar.

## 20 · Nachtrag (09.09.2026, Teil 2) — Schriftgröße, Inhaltsverzeichnis & Fortschrittsanzeige im Inline-Reader

Drei weitere Reader-Komfortfunktionen, bewusst **alle drei rein clientseitig**
(kein Backend-Feld, kein Redeploy nötig) — anders als der geräteübergreifende
Bookmark aus Abschnitt 19, der weiterhin offen ist.

- **Schriftgröße:** Zwei neue Buttons „A-"/„A+" in der Reader-Kopfzeile
  (`changeReaderFontSize`, Schritt 10 %, Grenzen 70–200 %). Setzt
  `rendition.themes.fontSize()` von epub.js. Die zuletzt gewählte Größe wird
  geräteweit (nicht pro Buch) in `localStorage`
  (`ajk_epub_fontsize`) gemerkt und beim nächsten Öffnen egal welches Buch
  direkt angewendet.
- **Inhaltsverzeichnis:** `mountEpubReader` liest über `book.loaded.navigation`
  die EPUB-eigene Navigation (nav.xhtml/toc.ncx) aus, eine Ebene tief geflacht
  (Kapitel + direkte Unterpunkte) in `readerToc`. Ein „Inhalt"-Button (nur
  sichtbar, wenn `readerToc` nicht leer ist) öffnet ein Overlay-Panel
  (`readerTocOpen`) mit der Kapitelliste; Klick auf einen Eintrag springt via
  `rendition.display(href)` direkt dorthin (`goToTocHref`) und schließt das
  Panel wieder. Kein neuer Bookmark-Konflikt: die zuletzt gespeicherte CFI
  bleibt unberührt, der Sprung ist rein navigatorisch.
- **Fortschrittsanzeige:** Ein dünner Balken unter der Kopfzeile
  (`readerProgress`, 0–100 %). Berechnet im `relocated`-Handler aus
  `location.start.index / (book.spine.items.length - 1)` — also Position im
  Spine (Kapitel-/Dateireihenfolge der EPUB), nicht aus `book.locations`
  (das würde ein einmaliges, bei großen Büchern spürbar langsames
  `book.locations.generate()` brauchen). Etwas gröber als eine echte
  Zeichen-genaue Prozentanzeige, aber ohne Performance-Kosten.

**Getestet vor dem Push:** `node --check` gegen den aus dem Bundle
extrahierten Klassen-Code (Syntax-Fehler ausgeschlossen) sowie ein
Tag-Bilanz-Check (`sc-if`/`sc-for`/`div`/`button` open vs. close, vor/nach
Patch) am aus dem `__bundler/template`-Blob per `JSON.parse` dekodierten
HTML — beides sauber. **Kein Playwright-Klicktest gegen eine echte EPUB**
in dieser Session (kein Live-Backend-Zugriff) — Autor sollte nach dem Push
einmal live gegenlesen (Schriftgröße ändern, Inhaltsverzeichnis öffnen und
springen, Fortschrittsbalken beim Scrollen beobachten).

**Offen / als Nächstes vorgeschlagen:** geräteübergreifender Bookmark-Sync
(Abschnitt 19) und eine KI-Vorlesefunktion (Kostenvergleich ElevenLabs vs.
OpenAI TTS steht noch aus, separat vom Autor angefragt).

## 21 · Nachtrag (09.09.2026, Teil 3) — Geräteübergreifender Lese-Bookmark

Löst die in Abschnitt 19 benannte bewusste Grenze auf: die Leseposition wird
jetzt zusätzlich zum localStorage-Bookmark **serverseitig pro Zugangscode +
EPUB-Datei** gespeichert — Handy und Laptop mit demselben Zugangscode
landen an derselben Stelle.

**Frontend (index.html, bereits gepusht):**
- `openReader` fragt beim Öffnen **parallel** (`Promise.all`) sowohl
  `getEpubData` (unverändert) als auch die neue Aktion `getBookmark` ab —
  kein zusätzlicher Round-Trip zur bereits laufenden EPUB-Ladezeit. Ohne
  Zugangscode wird `getBookmark` gar nicht erst angefragt.
- `mountEpubReader(base64, serverCfi)` bevorzugt `serverCfi`, fällt nur ohne
  Server-Antwort auf den localStorage-Bookmark zurück (Offline-/Fallback-Kopie,
  bleibt bestehen).
- Im `relocated`-Handler wird die aktuelle CFI weiterhin sofort in
  localStorage geschrieben, zusätzlich aber **gedrosselt (2s Debounce)** per
  neuer Methode `syncBookmarkToServer` an die Aktion `saveBookmark` gepostet
  — verhindert einen Request pro Scroll-Tick.

**Backend — NICHT automatisch live, manueller Schritt nötig:**
Fertiger, additiver Codeblock liegt bereit unter
`reference/apps-script/BookmarkSync.gs` (gleiches bewährte Muster wie
`RevisionModule.gs`, Abschnitt 15: eigener Sheet-Tab `Bookmarks`
(Code, EpubUrl, Cfi, UpdatedAt), zwei neue Aktionen `getBookmark`/
`saveBookmark`, einziger Eingriff in bestehenden Code ist eine Zeile ganz am
Anfang von `handle(e)`). **Muss vom Autor manuell in den Apps-Script-Editor
eingefügt, `setupBookmarkSync` einmalig ausgeführt und neu deployt werden**
(siehe die „New version"-Falle in Abschnitt 7) — ohne diesen Schritt bleibt
`getBookmark`/`saveBookmark` unbekannt und der Reader fällt automatisch auf
den bisherigen rein lokalen Bookmark zurück (kein kaputter Reader, nur kein
Sync).

**09.09.2026, Teil 5 — echtes Code.gs erhalten, Integration bestätigt und
bequemer gemacht:** Nutzer hat den kompletten aktuellen `Code.gs`-Inhalt im
Chat eingefügt. Bestätigt: `handle(e)`/`jsonOut(obj)`-Muster stimmt exakt
mit der Annahme in `BookmarkSync.gs` überein, keine Namenskollisionen
(weder Funktionsnamen noch die Actions `getBookmark`/`saveBookmark`).
Zwei Ablagen ergänzt:
- `reference/apps-script/Code.gs` — Referenz-Snapshot des echten Backends
  (kein Auto-Sync, kann von der Live-Version abweichen, siehe Kopfkommentar
  der Datei). Erspart künftigen Sessions das erneute Blind-Raten bei
  Backend-Änderungen.
- Dieser Snapshot enthält bereits **beide** additiven Integrationszeilen
  (Stil-Revisions-Modul UND Lese-Bookmark-Sync) ganz am Anfang von
  `handle(e)` — der Autor kann die Datei jetzt komplett 1:1 über sein
  bestehendes `Code.gs` im Apps-Script-Editor kopieren, statt die eine
  Zeile manuell zu suchen und einzufügen. `BookmarkSync.gs` weiterhin
  zusätzlich als eigene neue Datei im Editor anlegen (Schritt 2 der
  Anleitung oben bleibt gleich), nur der Integrationsschritt (Schritt 3)
  entfällt durch den fertigen Snapshot.

**Auth-Modell bewusst einfach:** `code` wird hier nur als opaker Schlüssel
zur Trennung der Bookmarks genutzt, nicht erneut gegen das Access-Sheet
geprüft — eine CFI ist keine schützenswerte Information (der Nutzer hat die
zugehörige EPUB-Datei ohnehin schon über `getEpubData`/`epubAccess`
bekommen müssen). Details und eine optionale strengere Variante stehen im
Kommentarblock von `BookmarkSync.gs`.

**Nicht getestet in dieser Session** (kein Live-Backend-Zugriff, kein
Playwright-Klicktest) — nur `node --check` auf den aus dem Bundle
extrahierten JS-Code sowie JSON.parse-Validierung des `__bundler/template`-
Blobs. Autor sollte nach Backend-Deploy auf zwei Geräten mit demselben Code
gegenlesen.

## 22 · Nachtrag (09.09.2026, Teil 4) — Kostenlose Vorlesefunktion (Web-Speech-API, Übergangslösung)

Nutzer-Wunsch: bis zu einer möglichen KI-Vorlesestimme (ElevenLabs/OpenAI
TTS, Kostenvergleich in dieser Session gegeben, noch keine Entscheidung)
etwas Kostenloses zum Vorlesen. Umgesetzt über die **browsereigene Web-
Speech-API** (`window.speechSynthesis`) — kein Backend, kein API-Key, keine
Kosten. Klingt spürbar synthetischer/monotoner als ElevenLabs/OpenAI, aber
sofort nutzbar.

- Neuer „Vorlesen"/„Stop"-Button in der Reader-Kopfzeile (nur sichtbar, wenn
  der Browser `speechSynthesis` unterstützt — `hasSpeechSupport`, praktisch
  alle aktuellen Desktop-/Mobile-Browser).
- `startReadingAloud` liest den Text der **aktuell im Reader gerenderten
  Sektion(en)** (`rendition.getContents()` → `textContent`), nicht das ganze
  Buch — bewusste Grenze, siehe unten.
- Text wird in ~300-Zeichen-Häppchen zerlegt (`speechChunks`, an Satzenden
  wo möglich) und nacheinander per `SpeechSynthesisUtterance` vorgelesen
  (`speakNextChunk_`) — manche Browser brechen sehr lange Utterances sonst
  kommentarlos ab.
- Sprache der Stimme: aus den EPUB-Metadaten (`book.package.metadata.language`)
  übernommen, Fallback `document.documentElement.lang`, dann `de-DE`. Welche
  konkrete System-/Browser-Stimme dafür verwendet wird, entscheidet der
  Browser (nicht steuerbar ohne eigene Stimmauswahl-UI — hier bewusst nicht
  gebaut, wäre der nächste Ausbauschritt).
- Wird automatisch gestoppt beim Schließen des Readers (`closeReader`) und
  beim Sprung über das Inhaltsverzeichnis (`goToTocHref`) — sonst würde
  veralteter Text weiterlaufen.

**Bewusste Grenze:** Liest nur die aktuell sichtbare/geladene Sektion vor,
nicht automatisch das nächste Kapitel beim Erreichen des Endes (kein
Auto-Advance über Kapitelgrenzen). Für „einfach nebenbei zuhören, während
man länger unterwegs ist" müsste man aktuell nach jedem Kapitel erneut auf
„Vorlesen" klicken. Bei Bedarf nachrüstbar (z. B. am Ende der Chunks in den
nächsten Spine-Eintrag springen und automatisch weiterlesen).

**Nicht getestet in dieser Session** (kein Browser mit echter EPUB
verfügbar) — nur `node --check` + JSON.parse-Validierung wie bei den
vorherigen Nachträgen. Klingt je nach Betriebssystem/Browser unterschiedlich
(z. B. deutlich besser mit den neueren macOS-/Chrome-Systemstimmen als mit
älteren Windows-Stimmen) — einmal live probehören.

## 23 · Nachtrag (09.09.2026, Teil 6) — Bugfix: Admin ohne Gast-Zugangscode konnte den Reader nicht öffnen

**Gemeldet vom Autor:** Nach Merge von PR #9 im Notebook-Browser als Admin
eingeloggt (nur Admin-Passwort, kein zusätzlicher Gast-Zugangscode
eingegeben) → Klick auf „Read" bei einem Buch → „Kein Zugriff auf dieses
Buch." Auf dem Handy ging es, weil dort noch ein alter Gast-Zugangscode mit
vollem Zugriff in `localStorage` lag — auf dem Notebook fehlte der.

**Root Cause — vorbestehende Lücke, nicht durch die neuen Reader-Features
verursacht:** Admin-Login (`checkPassword`/`adminToken`) und
Gast-Zugangscode (`visitorAccessCode`, für `checkAccess`) sind zwei
komplett getrennte Systeme. `getEpubData` im Backend hat bisher **nur**
den Gast-Zugangscode gegen das Access-Sheet geprüft — den Admin-Status nie.
Dasselbe clientseitig: `onOpen`/`onEpub`/`onBg`/`onVideo`/die `*Href`-Links
prüften nur `s.visitorCanDownload`, nie `s.isAdmin`. Nur die
**Bücher-Sichtbarkeit** (welche Bücher überhaupt in der Liste erscheinen)
hatte schon einen Admin-Bypass (Abschnitt 9, „Admin sieht immer alle
Bücher") — das Lesen/Downloaden selbst nicht.

**Fix — Admin bekommt jetzt konsequent volle Rechte, wie bei der
Sichtbarkeit:**
- **Frontend (index.html):** neue lokale Variable `canRead = s.isAdmin ||
  s.visitorCanDownload` pro Buch, ersetzt alle 15 bisherigen
  `s.visitorCanDownload`-Vorkommen (Read-/EPUB-/Background-/Video-Links,
  Klick-Handler, Farbgebung der Icons). `openReader`/`downloadEpub` senden
  jetzt zusätzlich `adminToken: this.state.adminToken || ''` mit.
- **Backend (`reference/apps-script/Code.gs`, `getEpubData`):**
  `hasFullAccess` startet jetzt mit `checkAdmin(e).ok` statt `false` —
  admin-eingeloggte Requests überspringen die Access-Sheet-/EpubAccess-
  Prüfung komplett, exakt wie bei den anderen admin-geschützten Aktionen.
  **Muss erneut manuell im Apps-Script-Editor eingefügt und neu deployt
  werden** (siehe die „New version"-Falle in Abschnitt 7) — der
  Referenz-Snapshot in `reference/apps-script/Code.gs` ist bereits
  aktualisiert und kann wie zuvor 1:1 kopiert werden.

**Getestet:** `node --check` gegen den aus dem Bundle extrahierten
JS-Code sowie gegen `Code.gs` separat, JSON.parse-Validierung des
Templates, Tag-Bilanz-Check (unverändert, da nur die JS-Logik betroffen
war, kein Template-Markup). Ein Zwischenstand hatte kurzzeitig einen
Self-Reference-Bug (`const canRead = s.isAdmin || canRead`, durch ein zu
grobes Suchen-und-Ersetzen) — vor dem Commit gefunden und korrigiert, indem
gezielt nur die Deklarationszeile geprüft wurde.

## 24 · Nachtrag (10.09.2026) — Bugfix: Buttons liefen trotz flex-wrap-Fix weiter am rechten Rand aus dem Bild

Nach PR #10 (Abschnitt 23) hat der Autor per Screenshot bestätigt: die
Reader-Kopfzeile und das Zugänge-Panel sahen auf dem iPhone (Safari)
weiterhin "abgeschnitten" aus, obwohl der `flex-wrap`-Fix drin war und die
Seite frisch neu geladen wurde.

**Root Cause — nicht der einzelne flex-Container, sondern die ganze
Seite:** `flex-wrap` wrapt nur, wenn der *eigene* Flex-Container zu schmal
wird. Hat aber IRGENDEIN anderes Element auf der Seite (egal wo) eine
Breite über 100 % Viewport, bekommt `<body>` horizontalen Overflow — und
iOS Safari erlaubt dann das ganze Dokument seitlich zu schieben
("Panning"), **inklusive** `position:fixed`-Overlays wie den Reader oder
das Admin-Panel. Diese haben zwar selbst korrekt `width:100%`/`inset:0`,
werden aber beim seitlichen Scrollen der Seite optisch mitgeschoben und
wirken dadurch rechts abgeschnitten — unabhängig davon, ob der einzelne
Button-Container selbst umbricht. Screenshot-Indiz: mehrere unabhängige
Elemente (Buttons UND Eingabefelder) waren an exakt derselben rechten
Kante gekappt — typisches Muster für Seiten-weiten Overflow, nicht für
einen einzelnen kaputten Container.

**Fix:** Globale Absicherung statt lokaler Einzelfälle —
`html,body{overflow-x:hidden; max-width:100%;}` ganz oben im globalen
`<style>`-Block der Seite (vor der ersten `body{...}`-Regel). Verhindert
grundsätzlich, dass irgendein zu breites Element (egal welches, auch
zukünftige) die ganze Seite horizontal aufreißt — deutlich robuster als
jeden einzelnen Container einzeln zu jagen.

**Stolperstein in dieser Session:** Der erste Versuch hat versehentlich
`//`-Kommentare (JS-Stil) in den CSS-`<style>`-Block geschrieben — CSS
kennt nur `/* */`-Blockkommentare, `//` ist dort kein gültiger
Kommentar-Start. Vor dem Commit bemerkt (beim erneuten Decodieren/
Validieren) und auf `/* */` korrigiert.

**Getestet:** JSON.parse-Validierung des `__bundler/template`-Blobs,
`node --check` gegen den extrahierten JS-Code, Tag-Bilanz-Check
(unverändert — nur CSS-Regel ergänzt, keine Tags), zusätzlich
Geschweifte-Klammern-Balance beider `<style>`-Blöcke geprüft (43/43 bzw.
23/23). Kein Live-Browser-Test in dieser Session — Autor sollte nach
Merge + Cache-Reset erneut auf dem iPhone gegenlesen.

## 25 · Nachtrag (10.09.2026, Teil 2) — Portrait auf der About-Seite austauschbar über das Admin-Panel

Nutzer-Wunsch: eigenes Portrait nicht mehr fest im kompilierten Bundle
eingebacken haben, sondern jederzeit selbst über das Admin-Panel
austauschen können (wie schon bei den Part-Bildern) — ohne dafür jedes
Mal eine Code-Änderung/einen Push zu brauchen.

**Bewusst ohne Backend-Änderung umgesetzt** — nutzt exakt dieselbe
bereits vorhandene generische `SettingsData`-Ablage (`getSettings`/
`saveSettings`, ein JSON-Blob in Zelle A1 eines eigenen Sheet-Tabs), die
auch die Part-Bilder der Poems-Sektion speichert. Kein neues Sheet-Feld,
kein Redeploy nötig.

- Neuer Admin-Panel-Abschnitt „Portrait (About-Seite)" direkt über
  „Part-Bilder" — ein URL-Eingabefeld (`portraitUrlInput` →
  `setPortraitUrl`), das denselben `normalizeDriveImageUrl`-Helfer
  wiederverwendet wie die Part-Bilder (wandelt einen eingefügten
  Drive-„Freigeben"-Link automatisch in die eingebettete
  `lh3.googleusercontent.com`-Form um). Vorschau-Bild erscheint sofort,
  sobald eine URL gesetzt ist. Teilt sich den bestehenden
  „Speichern"-Button/`saveSettings`-Aufruf mit den Part-Bildern (spart
  einen zweiten Button, speichert ohnehin das ganze `settings`-Objekt).
- About-Seite: der bisher fest eingebackene Portrait-`<img>`
  (Bundle-Asset-UUID) bleibt als **Fallback** erhalten (`hasNoCustomPortrait`),
  wird aber durch das per Settings gesetzte Bild ersetzt, sobald
  `portraitUrl` nicht leer ist (`hasCustomPortrait`) — zwei sich
  gegenseitig ausschließende `sc-if`-Zweige. Leeres Feld = alter Zustand
  bleibt unverändert sichtbar, nichts kann dadurch kaputtgehen.

**Getestet:** JSON.parse-Validierung des Templates, `node --check` gegen
den extrahierten JS-Code, Tag-Bilanz-Check (+4 `sc-if`, +1 `div`, +1
`button`, +1 `img`, +1 `input` — passt exakt zu den vier neuen Blöcken).
Kein Live-Browser-Test in dieser Session. Nächster Schritt für den Autor:
sein Portrait-Bild (z. B. die im Chat geteilte Illustration) irgendwo mit
öffentlichem Link ablegen (Drive reicht, gleicher Mechanismus wie bei
Buch-Covern/Part-Bildern) und den Link im neuen Admin-Feld einfügen +
Speichern.

## 26 · Nachtrag (10.09.2026, Teil 3) — Bugfix: Bücher-Zeile im Admin-Panel quetschte sich bei langem Serien-Label zusammen

Per Screenshot gemeldet: die Bücher-Verwaltungsliste im Admin-Panel sah
bei „The Arche" (hat ein Serien-Label, z. B. „Corpus · Band 2") kaputt
aus — Titel und Label quetschten sich auf mehrere sehr schmale Zeilen
zusammen, während die Buttons (↑ ↓ Edit Delete) unverändert breit blieben.
Bei Büchern ohne Serien-Label (kürzerer Textinhalt links) fiel es nicht
auf.

**Root Cause — exakt dasselbe Muster wie Abschnitt 24, nur an einer
Stelle, die dort übersehen wurde:** Die Bücher-Zeile
(`display:flex; justify-content:space-between; gap:16px; align-items:center;`)
hatte kein `flex-wrap`, und der linke Info-Block (Titel + Serien-Label)
keine `min-width:0`. Ohne Umbruch-Option quetscht ein Flex-Container den
schrumpfbaren linken Block beliebig eng zusammen, statt die Zeile auf
zwei Zeilen umzubrechen — bei genug Textinhalt links (hier: das
zusätzliche Serien-Label) wird das sichtbar hässlich, obwohl der globale
`overflow-x:hidden`-Fix aus Abschnitt 24 das seitliche Wegrutschen der
ganzen Seite bereits verhindert hatte (das war ein anderes Problem: Seite
komplett aus dem Bild vs. ein einzelner Container quetscht sich intern
zusammen).

**Fix:** Gleiches Muster wie bei der Zugänge-Liste und den EPUB-Zugriff-
Zeilen — `flex-wrap:wrap; row-gap:8px;` auf dem äußeren Zeilen-Container,
`flex:1 1 auto; min-width:0;` auf dem linken Info-`<div>`.

**Getestet:** JSON.parse-Validierung, `node --check`, Tag-Bilanz-Check
(unverändert, nur Style-Attribute geändert). Kein Live-Browser-Test in
dieser Session.

**Für spätere Sessions vorgemerkt:** Dieses Zeilen-Muster
(`justify-content:space-between` + nicht-schrumpfender Button-Block ohne
`flex-wrap`) kommt an mehreren Stellen im Admin-Panel vor. Drei Stellen
sind jetzt gefixt (Zugänge-Liste, EPUB-Zugriff-Zeilen, Bücher-Liste) —
falls weitere ähnliche „quetscht sich zusammen"-Meldungen kommen (z. B.
bei der Gedichte-Liste, die vermutlich dasselbe Muster nutzt), lohnt sich
ein gezielter Blick auf alle `justify-content:space-between`-Zeilen mit
`flex-shrink:0`-Button-Gruppe auf einmal, statt einzeln nachzujagen.

## 27 · Nachtrag (10.09.2026, Teil 4) — Bugfix: Buch-Bearbeiten-Formular im Admin-Panel lief bei langen Platzhaltertexten aus dem Bild

Per Screenshot gemeldet: die Bearbeiten-Ansicht eines Buchs (Titel, Genre,
Reihe/Band, Summary, Status, Übersetzungen, Manuskript-Link, Wortzahl,
Cover-URL) sah auf dem iPhone zerschossen aus — mehrere Eingabefelder und
ein Button liefen über den rechten Bildschirmrand hinaus, obwohl die
vorherigen Fixes (Abschnitt 24/26) bereits griffen.

**Root Cause — eine dritte Variante desselben Grundproblems, diesmal
nicht fehlendes `flex-wrap`, sondern `min-width:auto`:** CSS-Grid- und
Flex-Kindelemente haben standardmäßig `min-width:auto`, was bei
Formularfeldern heißt: die Mindestbreite orientiert sich am Inhalt
(inkl. Platzhaltertext). Felder mit langem `placeholder` — z. B. „Reihe
(z. B. 'Die Nil-Trilogie') — leer lassen bei Einzelband" oder „Manuskript
(Google-Doc-Link, für automatische Wortzahl)" — weigern sich dadurch,
unter ihre Inhalts-Mindestbreite zu schrumpfen, selbst wenn der
Container schmaler ist. Anders als bei Abschnitt 24 (ganze Seite rutscht
seitlich weg) blieb hier dank des globalen `overflow-x:hidden`-Fixes die
Seite selbst stabil — die einzelnen Felder wurden am Viewport-Rand
schlicht abgeschnitten, statt die Seite wegrutschen zu lassen. Sichtbar
nur bei Feldern mit langem Platzhalter, kurze Felder (Titel, Status)
fielen bisher nicht auf.

**Fix:** `min-width:0` (bei Flex-Items zusätzlich ein sinnvoller fester
`min-width`-Wert, damit sie nicht auf 0 kollabieren) an allen
Formularfeldern im Buch-Bearbeiten-Formular, plus `width:100%;
box-sizing:border-box;` an den vollbreiten Einzelfeldern (Title, Kind,
Status, Summary-Textarea, Übersetzungen, Manuskript-Link, Cover-URL) und
`flex-wrap:wrap; row-gap:8px;` an den beiden zweispaltigen Zeilen
(Reihe/Band; Wortzahl + „Aus Manuskript berechnen"-Button).

**Getestet:** JSON.parse-Validierung, `node --check`, Tag-Bilanz-Check
(unverändert — nur Style-Attribute geändert, `input`/`textarea`-Anzahl
gleich geblieben). Kein Live-Browser-Test in dieser Session.

**Für spätere Sessions vorgemerkt:** `min-width:auto` auf Grid-/Flex-
Kindelementen mit langem `placeholder`-Text ist ein eigenständiges
Muster, unabhängig von den bereits gefixten `justify-content:space-
between`-Zeilen aus Abschnitt 24/26 — beide Muster können gleichzeitig
im selben Formular auftreten (wie hier). Bei künftigen „läuft aus dem
Bild"-Meldungen im Admin-Panel beides parallel prüfen: fehlendes
`flex-wrap` UND fehlendes `min-width:0` auf Formularfeldern mit langen
Platzhaltern.

## 28 · Nachtrag (11.09.2026) — Fix: Neu angelegtes Buch verschwand spurlos wieder

Nutzer-Bug-Report: Ein neu angelegtes Buch tauchte im Admin-Panel kurz auf,
verschwand nach ein paar Minuten aber wieder — ohne Fehlermeldung. Diagnose:
Der Drive-Ordner für das Buch existierte nie (`syncDriveForAllBooks` legt
Ordner automatisch für jedes Buch in `getBooksArray()` an — kein Ordner
heißt, das Buch war zum Zeitpunkt des Sync-Laufs serverseitig gar nicht
mehr in `BooksData` vorhanden).

**Ursache gefunden:** `persistBooks()`/`persistPoems()` hatten ein leeres
`.catch(() => {})` am `fetch(...)`-Aufruf, der die eigentliche Speicherung
ans Backend schickt — und prüften nie, ob die Server-Antwort `ok:true`
oder `ok:false` war. Schlug das Speichern fehl (z. B. abgelaufenes Admin-
Token nach den in `checkAdmin` hart codierten 24 Stunden, oder ein
Netzwerkfehler), wurde das **komplett stillschweigend verschluckt** — die
UI zeigte die Änderung trotzdem an (kommt direkt aus `this.state`), weil
`setState` ja lokal bereits gelaufen war, bevor der Server-Request überhaupt
startet. Erst beim nächsten `fetchBooks()`/Neuladen kam die tatsächliche
(unveränderte) Serverliste zurück und überschrieb den lokalen Stand — das
Buch „verschwand" ohne jede Erklärung.

**Fix:** Beide Funktionen prüfen jetzt `data.ok` aus der Serverantwort und
zeigen bei Fehlschlag einen deutlichen `window.alert` mit der Fehlerursache
(inkl. Hinweis „nur lokal sichtbar, nicht für andere") und dem Vorschlag,
sich neu als Admin einzuloggen. Gleiches bei einem reinen Verbindungsfehler
(vorheriges leeres `.catch` ersetzt). Kein Backend-Update nötig, rein
Frontend.

**Nicht behoben, weil außerhalb des ursprünglichen Bug-Reports:** Die
zugrunde liegende 24h-Token-Ablaufzeit selbst bleibt bestehen — bei langen
Admin-Sitzungen kann das Token also weiterhin mitten in der Arbeit
ablaufen. Jetzt bekommt man es nur wenigstens sofort angezeigt, statt es
erst Minuten später am verschwundenen Buch zu bemerken.
