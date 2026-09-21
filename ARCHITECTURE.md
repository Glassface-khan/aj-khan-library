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

## 29 · Nachtrag (14.09.2026) — Fix: „Fertig"-Status-Check war groß-/kleinschreibungsempfindlich

Nutzer-Bug-Report: Neu angelegtes Buch mit fertigem EPUB (Wortzahl, Cover,
Genre — alles laut `DriveSyncLog` korrekt übernommen) zeigte trotzdem
„Noch kein Lesezugriff hinterlegt." beim Klick auf „Read". Ursache: Der
Status im Admin-Panel war als **„fertig"** (klein) eingetragen, aber
`bookIsFinished = (b.status || '').trim().startsWith('Fertig')` prüfte
**exakt** auf ein großes „F" — „fertig" bestand die Prüfung nicht, das
Buch galt seiten-intern also als „nicht fertig", obwohl es das inhaltlich
war. Gleiches Muster (`b.status.startsWith('In Entwicklung')`) betraf auch
das `mark`-Feld (◆/○-Symbol neben dem Buchtitel).

**Fix:** Alle drei Stellen (`bookIsFinished`, `finishedBookTitles` für die
EPUB-Zugriffs-Checkliste im Admin-Panel, `mark`) vergleichen jetzt
groß-/kleinschreibungsunabhängig (`.toLowerCase().startsWith('fertig')`
bzw. `'in entwicklung'`) — „Fertig", „fertig" und „FERTIG" zählen jetzt
alle gleich. Rein Frontend, kein Backend-Update nötig.

## 30 · Nachtrag (14.09.2026, Teil 2) — Usability-Runde: explizite "fertig"-Checkbox, Fehlt-noch-Checkliste, robustere Dateinamen-Erkennung

Nutzer-Feedback nach mehreren Runden Fehlersuche: Die Seite ist an
mehreren Stellen unnötig empfindlich gegenüber kleinen Abweichungen
(Groß-/Kleinschreibung, fehlende Rückmeldung), was das Handling
umständlich macht. Statt weiter Einzelsymptome zu flicken, hier eine
gebündelte Runde an der eigentlichen Fehlerklasse.

**1. Explizite "Buch ist fertig zum Lesen"-Checkbox statt Status-Text-
Parsing.** Der bisherige Ansatz (`status.startsWith('Fertig')`, in
Abschnitt 29 schon case-insensitive gemacht) bleibt strukturell
fehleranfällig, weil er ein *Freitextfeld* für eine *maschinelle*
Entscheidung zweckentfremdet. Neues Buchfeld `isFinished` (Boolean) —
echter Schalter, kann nie an Tippfehlern scheitern. Der Status-Text bleibt
für die freie Beschreibung erhalten (z. B. "Fertig (Submission-Materialien
erstellt)"), hat aber keinen Einfluss mehr auf Read/EPUB-Freischaltung.
**Rückwärtskompatibel:** `bookIsFinished = (b.isFinished !== undefined) ?
!!b.isFinished : <alter Status-Text-Fallback>` — bestehende Bücher ohne
das neue Feld funktionieren unverändert weiter, bis sie einmal gespeichert
werden (dann wird `isFinished` Teil ihrer Daten). Neue Checkbox im
Buch-Bearbeiten-Formular direkt unter dem Status-Feld.

**2. "Fehlt noch"-Checkliste pro Buch im Admin-Panel.** Direkt in der
Buchzeile (nicht erst nach Klick auf Edit) erscheint jetzt eine kleine
Warnzeile, falls: kein Cover hinterlegt, kein Manuskript-Link (`pdfUrl`/
`manuscriptDocUrl`), das Buch als fertig markiert ist aber noch kein
`epubUrl` vorliegt (Drive-Sync steht noch aus oder ist fehlgeschlagen),
oder das Buch noch nicht als fertig markiert ist. Rein aus vorhandenen
Buchdaten berechnet — **kein Backend-Update nötig**. Macht auf einen
Blick sichtbar, was nach dem Anlegen eines Buchs noch aussteht, ohne dass
man dafür Drive oder das Sync-Log durchsuchen muss.

**3. Lösch-Fehler bei Zugängen jetzt sichtbar.** `removeAccessPerson` hatte
dasselbe stille-Fehlschlag-Muster wie `persistBooks`/`persistPoems` vor
Abschnitt 28 (leeres `.catch`, keine `data.ok`-Prüfung). Gleicher Fix:
`window.alert` bei Fehlschlag statt stillem Nichtstun.

**4. Backend (`Code.gs`): Datei-Präfix-Erkennung jetzt groß-/klein-
schreibungsunabhängig.** `findFileByPrefix` (verwendet für `FINAL_`,
`ENTWURF_`, `KLAPPENTEXT_`, `GENRE_` und `metadata.json`) verglich bisher
exakt case-sensitiv — eine Datei `klappentext_Roman.docx` statt
`KLAPPENTEXT_Roman.docx` wurde stillschweigend ignoriert, ohne jede
Fehlermeldung (das Sync-Log zeigt ja nur, was gefunden wurde, nicht was
wegen falscher Schreibweise übersehen wurde). Jetzt vergleicht die
Funktion beide Seiten kleingeschrieben — `FINAL_`, `Final_`, `final_`
werden alle gleich erkannt.

**Bewusst nicht angegangen (auf Nutzerwunsch zurückgestellt):**
Admin-Token-Laufzeit (aktuell 24 Std., verantwortlich für die
"unauthorized"-Überraschungen aus Abschnitt 28) — Vorschlag stand im Raum
(z. B. auf 7 Tage verlängern), aber noch nicht bestätigt/umgesetzt.

**Größerer, separat zu planender Wunsch:** Ein geführter Buch-Anlege-
Assistent ("New Book" → Titel → Drive-Struktur wird angelegt → gezielte
Aufforderung, Manuskript/Klappentext/Cover/Alt-Cover *direkt aus dem
Browser* hochzuladen, inkl. automatisch korrekter Dateibenennung) —
deutlich größerer Umbau, weil er echten Datei-Upload vom Browser direkt
nach Drive erfordert (bisher lädt der Admin alles manuell in Drive hoch,
die Seite verlinkt nur; einzige bestehende Ausnahme ist der Cover-Upload
als eingebettetes Data-URL-Bild, bewusst auf 45 000 Zeichen gedeckelt —
für Manuskripte/Alt-Cover ungeeignet). Braucht einen neuen Backend-
Endpunkt (Datei-Bytes empfangen, in den richtigen Drive-Unterordner mit
korrektem Namensmuster ablegen) und eine mehrstufige Wizard-UI. Noch nicht
begonnen — als nächstes größeres Vorhaben vorgemerkt, eigene
Aufwandseinschätzung nötig, bevor losgelegt wird.

## 31 · Nachtrag (14.09.2026, Teil 3) — Usability-Runde Phase 1 ("Schnell & sinnvoll")

Auf Wunsch des Nutzers eine strukturierte Sammlung möglicher weiterer
Verbesserungen erstellt (kurz-, mittel- und langfristig gestaffelt) und die
als "schnell & sinnvoll" eingestuften vier Punkte direkt umgesetzt:

**1. Admin-Token-Laufzeit 24h → 7 Tage** (`Code.gs`, `checkAdmin`/
`ADMIN_TOKEN_LIFETIME_MS`). Löst die in §28 dokumentierte Ursache der
wiederholten "unauthorized"-Überraschungen — war dort bewusst
zurückgestellt, jetzt auf expliziten Nutzerwunsch umgesetzt.

**2. Erfolgs-Bestätigung ("Gespeichert ✓").** Neuer `savedToast`-State +
`showSavedToast()`-Helfer, zeigt einen kurzen grünen Hinweis unten am
Bildschirmrand (2,5 Sek., dann automatisch weg) nach erfolgreichem
Speichern von Büchern, Gedichten sowie Zugang anlegen/bearbeiten/entfernen.
Bisher gab es (seit §28/§17) nur bei FEHLERN eine Rückmeldung — bei Erfolg
blieb die UI stumm, was verunsicherte ("hat es jetzt geklappt?").

**3. Kopier-Button für Zugangscodes.** `copyAccessCode()` nutzt
`navigator.clipboard.writeText`, mit Fallback-Alert (Code manuell
markieren) falls die Clipboard-API im Browser fehlt. Sowohl in der
Admin-Zugangsliste (neben jedem bestehenden Code) als auch direkt beim neu
generierten Code nach dem Anlegen.

**4. Buch-Vorschau ("Vorschau"-Button im Bearbeiten-Formular).** Zeigt
Cover, Titel, Genre und Klappentext sowie den Fertig-Status in einem Modal
so an, wie ein Leser das Buch sehen würde — **inklusive noch
ungespeicherter Änderungen** (liest direkt aus `s.books[i]`, da
`setBookField` ohnehin sofort in den State schreibt, kein separates
Draft-Objekt). Zweck: Tippfehler/Formatierungsfehler im Klappentext oder
ein falsches Cover VOR dem Speichern erkennen, statt danach auf der Live-
Seite.

Alle vier Änderungen in `index.html`, Punkt 1 zusätzlich in `Code.gs`
(erfordert Redeploy).

## 32 · Nachtrag (14.09.2026, Teil 4) — Usability-Runde Phase 2 (ohne Statistik-Dashboard)

Fortsetzung der Verbesserungsrunde ("mittlerer Aufwand", auf Wunsch ohne
den Statistik/Dashboard-Punkt):

**1. Buchsuche für Leser.** Neues Suchfeld über der Werke-Liste, filtert
client-seitig (kein Backend-Roundtrip) nach Titel, Genre und
Klappentext-Text (`bookSearchQueryNorm`, angewendet auf
`visibleBooksSourceRaw` vor der bestehenden Sichtbarkeits-Filterung).
Zeigt "Keine Bücher gefunden für ..." wenn nichts passt.

**2. E-Mail-Benachrichtigung bei Erst-Login.** `notifyFirstLogin_()` in
`Code.gs`, aufgerufen aus `checkAccess`. Schickt eine Mail an
`Session.getEffectiveUser().getEmail()` (= das eigene Google-Konto, in dem
das Skript läuft — keine Konfiguration nötig), sobald sich ein
Zugangscode zum ALLERERSTEN Mal einloggt. Wiedererkennung über einen
`PropertiesService`-Marker (`firstlogin_<code>`), damit nicht bei jedem
weiteren Besuch erneut gemailt wird. Komplett in try/catch gekapselt —
ein Mail-Fehler darf den Login selbst niemals blockieren.
(Die zweite Hälfte der ursprünglichen Idee — Leser per Mail benachrich-
tigen, wenn ein neues Buch für sie freigeschaltet wird — ist NICHT
umgesetzt: es gibt aktuell keine Leser-E-Mail-Adressen im System, nur
Name+Code. Bräuchte ein neues Datenfeld, falls gewünscht.)

**3. Sprachumschalter DE/EN für die öffentliche Leser-Seite.** Auf
explizite Nachfrage bewusst auf die Leser-Seite beschränkt (Admin-Bereich
bleibt deutsch, da nur der Autor ihn nutzt — ca. 390 Textstellen dort,
unverhältnismäßiger Aufwand gegenüber Nutzen). Kleiner Umschalter-Button
im Kopfbereich, merkt Wahl in `localStorage` (`ajk_ui_lang`). Ein
`ui`-Objekt (berechnet aus `uiStrings[s.uiLang]`) für Template-Bindings
sowie ein `this.tr(de, en)`-Helfer für dynamisch erzeugte Meldungen
(Alerts, `viewerError`). Übersetzt wurden die bislang deutschen
Leser-Texte: Zugangscode-Feld, Absenden/Schließen/Zurück/Weiter/
Inhalt/Lädt…, Such-Platzhalter, Fehlermeldungen bei falschem Zugangscode/
Verbindungsfehler, sowie die Zugriffs-Hinweise (kein Lese-/Download-
Zugriff, EPUB/Hintergrund/Video/Alt-Cover noch nicht verfügbar). Der Rest
der öffentlichen Seite (Überschriften, Marketing-Text) war bereits auf
Englisch verfasst und blieb unverändert.

Punkt 1 und 3 nur `index.html` (kein Redeploy nötig), Punkt 2 zusätzlich
`Code.gs` (Redeploy nötig).

**Offen aus der ursprünglichen Liste:** der geführte Buch-Upload-
Assistent mit direktem Datei-Upload (weiterhin als eigenes, größeres
Vorhaben vorgemerkt, siehe §30) — Offline/PWA (unten, §33) wurde bereits
umgesetzt.

## 33 · Nachtrag (14.09.2026, Teil 5) — Offline/PWA: installierbare App + Offline-Zugriff auf zuletzt geöffnete EPUBs

Vom Nutzer aus der "größerer Aufwand"-Liste als gewünschter nächster Punkt
ausgewählt.

**1. Installierbare App.** Neue Dateien `manifest.webmanifest` sowie
`icons/icon-192.png`, `icons/icon-512.png`, `icons/apple-touch-icon.png` —
selbst generiertes AJK-Monogramm im bestehenden Marken-Farbschema (Bone/
Gold/Ink, siehe CSS-Variablen `--bone`/`--gold`/`--ink`), da keine
vorhandene Bilddatei als eigenständige PNG extrahierbar war (Bilder liegen
nur als vom Bundler aufgelöste opake Asset-IDs vor, nicht als Dateien im
Repo). Im echten `<head>` (nicht im Bundle-Blob) verlinkt: `<link
rel="manifest">`, `theme-color`, `apple-touch-icon`. Browser bieten damit
"Zum Startbildschirm hinzufügen" (iOS/Android) bzw. einen Install-Prompt
(Desktop-Chrome/Edge) an.

**2. Service Worker (`service-worker.js`), registriert ebenfalls im
echten `<head>`.** Cached die App-Shell (index.html, Icons) sowie GEZIELT
NUR lesende Backend-Antworten: `getBooks`, `getPoems`, `getSettings` (GET,
`?action=...`) sowie `getEpubData`, `getBookmark` (POST — dafür ein
synthetischer `Request` als Cache-Schlüssel aus Aktion + `epubUrl` +
`bookTitle` + `code`, da die Cache API nur GET-Requests direkt als
Schlüssel unterstützt und der eigentliche POST-Body sich ohnehin bei
jedem Aufruf ändert, z. B. durch das Admin-Token). Navigations-Requests:
Netzwerk zuerst, Fallback auf den zuletzt gecachten Stand bei Offline.

**Bewusst NICHT gecacht: alle schreibenden Aktionen** (`saveBooks`,
`savePoems`, `addAccess`, `updateAccess`, `removeAccess`, ...) — die
laufen immer direkt übers Netz. Grund: würde der Service Worker hier aus
dem Cache antworten, könnte offline der falsche Eindruck entstehen, eine
Änderung sei gespeichert worden, obwohl sie es nicht ist — analog zur
Fehlerbehandlungs-Philosophie aus §28/§31 (lieber sichtbar scheitern als
still falsche Sicherheit vortäuschen).

**Effekt:** ein einmal geöffnetes Buch bleibt offline lesbar (z. B. im
Flugzeug oder bei schlechtem Empfang), ebenso die zuletzt geladene
Bücher-/Gedichteliste samt Einstellungen.

Reine Frontend-/Static-Asset-Änderung (`index.html`-Kopf, `manifest.
webmanifest`, `service-worker.js`, `icons/`), kein Backend-Redeploy nötig.

## 34 · Nachtrag (14.09.2026, Teil 6) — Rollback: Offline/PWA wieder entfernt (ungeklärter "JSON Parse error")

Kurz nach dem Deploy von §33 meldete der Nutzer wiederholt einen Fehler
beim Laden der Seite: **"Error unpacking: JSON Parse error: unterminated
string at line 2 column 186"** — reproduzierbar auf mehreren Geräten
(iPhone/Safari, Windows-Notebook/Firefox und Edge, auch in einem neuen
Tab), sowohl mit als auch ohne VPN.

**Untersucht und AUSGESCHLOSSEN:**
- Kaputter Quellcode auf `main` — mehrfach per `git show origin/main:
  index.html` + `json.loads` geprüft (auch byte-genau an der vom Fehler
  genannten Stelle), durchgehend valide.
- Fehlgeschlagener/hängender GitHub-Pages-Deploy — `pages build and
  deployment`-Workflow-Runs zeigten durchgehend `conclusion: success` für
  den jeweils neuesten Commit.
- Client-seitiger Cache/Service-Worker (§33 v1→v2-Fix, `no-store`) — half
  nicht, Fehler blieb identisch (gleiche Zeile/Spalte).
- VPN — Fehler exakt gleich mit UND ohne VPN.
- Browser-Erweiterungen/-Cache — Fehler exakt gleich auch in neuem Tab.

**NICHT ausschließbar geprüft** (Nutzer am Arbeitsrechner, konnte
Antiviren-/Web-Schutz-Software nicht deaktivieren): eine
Sicherheits-Software mit HTTPS-Content-Inspection, die bei der recht
großen Seite (~9,6 MB, u.a. wegen der eingebetteten Bilder im
`__bundler/manifest`-Script-Tag, einer einzelnen JSON-Zeile mit ca. 9,3
Mio. Zeichen) ins Straucheln gerät. Auffällig: der Fehler
("line 2 column 186") zeigt auf eine sehr frühe Position innerhalb dieses
Manifests — genau der Teil, der in dieser gesamten Session **kein
einziges Mal verändert wurde** (keine Bild-/Cover-Änderungen). Die
eigentliche Ursache ist damit **nicht abschließend geklärt**.

**Entscheidung:** Da der Service Worker der einzige Teil war, der
grundlegend verändert hat, WIE die Seite geladen/zwischengespeichert
wird, und einen plausiblen (wenn auch nicht bewiesenen) Zusammenhang mit
"Antivirus kommt mit Service-Worker-Interception + großer Seite nicht
klar" haben könnte, wurde er zur Risikominimierung komplett entfernt:
- `service-worker.js`, `manifest.webmanifest`, `icons/*` gelöscht.
- Im echten `<head>` von `index.html`: aktive Abmeldung
  (`navigator.serviceWorker.getRegistrations().forEach(r => r.unregister())`)
  + Cache-Löschung (`caches.keys().then(...caches.delete...)`) für alle
  Bestandsbesucher, bei denen der Service Worker bereits registriert war
  — reines Entfernen der Registrierung hätte NICHT gereicht, da einmal
  installierte Service Worker aktiv bleiben, bis sie sich selbst
  abmelden.

**Falls der Fehler danach weiterhin auftritt:** liegt es nachweislich
NICHT am Service Worker / an dieser Session's Änderungen, sondern an
etwas Grundlegenderem (Netzwerk-/Sicherheits-Software beim Nutzer, oder
ein Problem mit der Größe/Struktur des `__bundler/manifest` selbst, das
vom Design-Canvas-Bundler stammt und außerhalb der Kontrolle dieses Repos
liegt) — dann als nächstes prüfen: Seite auf einem dritten, unbeteiligten
Netzwerk/Gerät testen, um Nutzer-lokale Ursachen endgültig auszuschließen.
Offline/PWA bleibt als Feature-Wunsch bestehen, müsste bei einem erneuten
Anlauf aber mit dieser Fehlerursache im Hinterkopf vorsichtiger
angegangen werden (z. B. Service Worker NUR fürs Caching einzelner
kleiner Dateien, nicht der ganzen App-Shell).

## 35 · Nachtrag (14.09.2026, Teil 7) — Ursache gefunden und behoben: extrem lange Einzelzeile in mehrere `<script>`-Chunks aufgeteilt

Fortsetzung von §34. Der `.nojekyll`-Fix (naheliegende erste Vermutung —
GitHub Pages verarbeitet `.html`-Dateien standardmäßig mit Jekyll/Liquid,
das die `{{ }}`-Bindings der Seite fälschlich als eigene Template-Syntax
lesen könnte) behob den Fehler **nicht**. Der entscheidende Test danach:
die Datei direkt über `raw.githubusercontent.com` geladen (komplett
andere Auslieferungs-Infrastruktur als GitHub Pages, kein Jekyll, kein
Fastly-Pages-Build) — **bricht dort ebenfalls mitten im Laden ab**. Das
belegt zweifelsfrei: die Ursache liegt weder an Jekyll noch an
GitHub-Pages-spezifischer Verarbeitung, sondern an etwas Grundlegenderem
in GitHubs Infrastruktur beim Ausliefern dieser Datei.

**Ursache:** Die Datei enthielt zwei außergewöhnlich lange EINZELNE
HTML-Zeilen ohne jeden Zeilenumbruch — das `__bundler/manifest`-Script-Tag
(Bilder als Base64, **~9,28 Millionen Zeichen auf einer Zeile**) und das
`__bundler/template`-Script-Tag (App-Code als JSON-String, ~305 000
Zeichen auf einer Zeile). Reproduzierbar auf 4 unabhängigen
Geräten/Netzwerken (iPhone/Safari, Windows-Notebook/Firefox+Edge,
zweites Handy/Chrome/4G) UND über zwei komplett unabhängige
GitHub-Auslieferungswege (Pages und raw.githubusercontent.com) — beides
spricht klar dafür, dass irgendwo in GitHubs Infrastruktur (vermutlich
ein Zeilenlängen-/Puffer-Limit beim Streaming ungewöhnlich langer
Einzelzeilen) diese beiden Zeilen beim Ausliefern abgeschnitten/
beschädigt wurden, bevor sie den Client überhaupt erreichten.

**Fix:** `__bundler/manifest` und `__bundler/template` werden nicht mehr
als je EIN riesiges `<script>`-Tag ausgeliefert, sondern in viele
kleinere `<script type="…" data-chunk="N">`-Tags mit je max. 300 000
Zeichen aufgeteilt (31 Chunks fürs Manifest, 2 fürs Template). Der
Bootstrap-Code (`readChunked(type)`, im echten, unverpackten `<script>`
ganz oben in `index.html`) sammelt beim Laden per
`querySelectorAll('script[type="…"]')` alle zusammengehörigen Chunks
ein, sortiert sie nach `data-chunk` und fügt ihre Texte per
`.join('')` wieder zum exakten Original-String zusammen, bevor
`JSON.parse()` läuft — inhaltlich identisch zu vorher (Konkatenation ist
ordnungserhaltend), nur eben nicht mehr als eine einzelne Zeile
ausgeliefert. Verifiziert: die zusammengesetzten Texte sind
zeichengenau identisch mit dem vorherigen Stand (Längenvergleich +
`json.loads()` auf beide) und die Bootstrap-Logik wurde separat per
`node --check` validiert.

**Für künftige Sessions wichtig:** Bricht ein Feature-Update aus
Versehen dieses Chunking wieder auf (z. B. weil ein Patch-Skript den
gesamten Manifest-/Template-Inhalt naiv wieder als EINE Zeile
zurückschreibt), tritt derselbe Ausfall erneut auf. Die Safe-Edit-
Methodik für `index.html` (siehe Abschnitt 2/CLAUDE.md) muss daher ab
sofort für diese beiden Script-Tags immer über `readChunked`-kompatible
Mehrfach-Tags erfolgen, nicht mehr über eine einzelne
`"<!DOCTYPE html>`-Zeile.

**KORREKTUR (14.09.2026, Teil 8): §35 war die falsche Diagnose — siehe
§36.** Das Chunking wurde wieder rückgängig gemacht (zurück auf je EINEN
`<script>`-Block wie ursprünglich), weil sich a) beim Chunking selbst ein
Bug einschlich (echte Zeilenumbrüche landeten im rekonstruierten Text,
siehe §36) und b) die eigentliche Ursache ohnehin eine andere war.

## 36 · Nachtrag (14.09.2026, Teil 8) — Die WIRKLICHE Ursache: unescapetes `</script>` innerhalb des Templates + eigener Bug beim Chunking-Versuch aus §35

Nach dem Chunking-Deploy (§35) trat der Fehler weiterhin auf. Verifikation
diesmal nicht nur per Regex/`json.loads()` auf isolierte Blöcke, sondern
mit einem ECHTEN HTML-Parser (Python `BeautifulSoup`, verhält sich wie
der DOM-Aufbau eines echten Browsers) — und DAMIT zwei Bugs gefunden, die
die vorherige, laxere Regex-Prüfung beide durchgewunken hatte:

**Bug 1 (selbst verursacht, §35-Chunking):** Beim Aufteilen in
`data-chunk`-Tags landete je ein echter Zeilenumbruch VOR und NACH dem
Inhalt jedes Chunks (`<script ...>\nINHALT\n</script>`) — der echte
Browser-DOM liefert diese Zeilenumbrüche als Teil von `.textContent`
mit, wodurch beim Zusammenfügen mehrerer Chunks echte Newline-Zeichen
MITTEN im JSON landeten (nicht nur am Rand, wo sie harmlos wären). Die
eigene Regex-Prüfung hatte das nicht bemerkt, weil ihr Muster diese
Newlines beim Extrahieren stillschweigend mit wegschnitt.

**Bug 2 (eigentliche Ursache, seit Langem vorhanden — nicht durch diese
Session verursacht):** Das `__bundler/template`-Script-Tag enthält an
drei Stellen (u.a. bereits bei Zeichen ~185, ganz am Anfang) ein
UN-escapetes `</script>` innerhalb des als JSON-String codierten
HTML-Inhalts (z. B. `<script src="…"></script>` als eingebettete
Ressourcen-Referenz). Der HTML-Parser jedes Browsers beendet ein
`<script>`-Element bei JEDEM literalen `</script`-Vorkommen — unabhängig
vom `type`-Attribut und unabhängig davon, dass es "eigentlich" nur Daten
innerhalb eines JSON-Strings sein soll. Der Browser bricht also das
äußere `__bundler/template`-Script-Tag genau an dieser Stelle ab, `.
textContent` liefert nur den abgeschnittenen Anfang zurück, und
`JSON.parse()` scheitert exakt mit "unterminated string" — **absolut
deterministisch, identisch auf jedem Gerät/Browser**, weil das eine
feste HTML-Spezifikationsregel ist, kein Netzwerk-/Cache-/
Umgebungsproblem. Das erklärt rückblickend zweifelsfrei, warum der
Fehler auf 4 unabhängigen Geräten/Netzwerken UND über zwei unabhängige
Auslieferungswege exakt gleich auftrat (§34/§35 gingen faelschlich von
einer Netzwerk-/Infrastruktur-Ursache aus).

**Fix:** Zurück auf je einen einzelnen `<script>`-Block pro Datenblock
(Chunking aus §35 rückgängig gemacht — unnötig und selbst fehleranfällig,
siehe Bug 1). Alle drei `</script`-Vorkommen im Template-Inhalt per
`\/` escaped (`<\/script` statt `</script`) — laut JSON-Spezifikation ein
gültiges, bedeutungsgleiches Escape für `/`, das der HTML-Tokenizer aber
NICHT mehr als Tag-Ende erkennt, weil kein literales `/` direkt auf `<`
folgt. Inhaltlich beim `JSON.parse()` exakt identisch zu vorher (per
Vergleich verifiziert). Der Manifest-Block enthielt zufällig keine
`</script`-Vorkommen, wurde aber vorsorglich mit demselben Mechanismus
behandelt.

**Verifiziert diesmal mit dem strengeren Test:** vollständiger
HTML-Parse via `BeautifulSoup`, `.get_text()` auf das gefundene
Script-Element (nicht nur Regex), `json.loads()` auf das Ergebnis, UND
Vergleich des decodierten Inhalts gegen den bekannten korrekten Stand
(`==`-Vergleich, nicht nur Längenvergleich) — alle vier Prüfungen
bestanden.

**Lehre für künftige Sessions:** Bei Aenderungen an `__bundler/manifest`
oder `__bundler/template` in `index.html` reicht ein reiner
`json.loads()`-Test auf eine per Regex/Zeilen-Split extrahierte
Teilzeichenkette NICHT aus, um sicherzustellen, dass der Inhalt auch als
ECHTES `<script>`-Tag im Browser korrekt ankommt — ein `</script`
irgendwo im codierten Inhalt bleibt für so einen Test unsichtbar, bricht
aber echte Browser zuverlässig. Vor jedem Deploy einer Änderung an
diesen beiden Bloecken zusaetzlich pruefen: `re.findall(r'</script',
raw_line, re.IGNORECASE)` muss leer sein (bzw. alle Treffer muessen als
`<\/script` escaped sein).

## 37 · Nachtrag (17.09.2026) — WICHTIG: `json.dumps()`-Rückfall der §36-Absicherung + Fix "Zugang erstellen" reagiert nicht bei leerem Namensfeld

**Rückfall entdeckt und sofort korrigiert:** Die Standard-Patch-Methodik
dieser Datei (`decoded = json.loads(line)` → String-Ersetzung im
Python-`str` → `line = json.dumps(decoded)` → zurückschreiben) macht die
`<\/script`-Absicherung aus §36 bei JEDER Anwendung automatisch wieder
rückgängig — `json.dumps()` gibt Forward-Slashes standardmäßig
UN-escaped aus (`\/` → `/`), auch wenn sie vorher bewusst escaped waren.
Das ist beim allerersten Edit nach §36 tatsächlich passiert und wurde
noch vor dem Deploy per HTML-Parser-Test bemerkt und korrigiert — aber
das haette leicht durchrutschen können.

**Ab sofort verbindlich für JEDEN Patch an `index.html`, der
`json.dumps()` auf den decodierten Template-/Manifest-Inhalt anwendet:**
direkt danach, vor dem Zurückschreiben, erneut
`re.sub(r'</script', r'<\\/script', line, flags=re.IGNORECASE)` auf die
serialisierte Zeile anwenden (idempotent — betrifft nur noch nicht
escapte Treffer, escapte `<\/script`-Stellen matcht das Regex-Muster
`</script` ohnehin nicht erneut). Und vor jedem Deploy grundsätzlich den
strengen Test aus §36 fahren (BeautifulSoup + `json.loads()` +
Inhaltsvergleich), nicht nur einen Regex-/Zeilen-Check.

**Kleinerer, unabhängiger Fix in diesem Nachtrag:** Der
"+ Zugang erstellen"-Button (`addAccessPerson`) brach bisher komplett
lautlos ab, wenn das Feld "Name der Person" leer war (`if (!name)
return;` ohne jede Rückmeldung) — für den Nutzer sah das aus wie ein
nicht reagierender Button. Zeigt jetzt `window.alert(...)` mit Hinweis,
zuerst einen Namen einzutragen.

## 38 · Nachtrag (17.09.2026, Teil 2) — Fix: fetchAccessList() scheiterte lautlos + Alt-Cover-Direkt-Upload vom Gerät (kein Drive nötig)

**1. Fehlermeldung bei `fetchAccessList()`.** Gleiches Muster wie schon
mehrfach zuvor (persistBooks/persistPoems/addAccessPerson): scheiterte
bisher komplett lautlos (leeres `.catch`, kein `data.ok`-Check) — die
Liste bestehender Zugänge blieb dann einfach leer, ohne jeden Hinweis,
ob es wirklich keine gibt oder das Laden fehlgeschlagen ist. Neuer
State `accessListError`, angezeigt als roter Kasten über der
Zugangsliste. Damit beim Nutzer tatsächlich reproduziert: abgelaufenes
Admin-Token ("unauthorized") — behoben durch Neu-Login. **Wichtiger
Nebenbefund dabei:** die 7-Tage-Verlängerung des Admin-Tokens (§31)
wirkt nur, wenn die zugehörige `Code.gs` auch tatsächlich im
Apps-Script-Editor deployt wurde — unklar, ob das beim Nutzer geschehen
ist; ggf. bei künftigen "unauthorized"-Meldungen zuerst danach fragen.

**2. Alt-Cover-Direkt-Upload vom Gerät.** Nutzerwunsch: Bücher liegen
auf iCloud, ein einfacherer Upload-Weg als "Datei manuell in Google
Drive hochladen, dann Link einfügen" war gewünscht. Nach Rückfrage
(AskUserQuestion) auf **Cover/Alt-Cover** eingegrenzt — Cover-Upload
existierte bereits (`handleCoverFile`, seit einer früheren Session:
Bild wird client-seitig auf 220px Breite verkleinert, als JPEG mit
sinkender Qualität komprimiert bis unter ~45.000 Zeichen, und als
Data-URL DIREKT im Buch-Datensatz gespeichert — kein Drive-Umweg, kein
neuer Backend-Endpunkt nötig, da `saveBooks`/`getBooks` jedes
Buch-Feld generisch als JSON durchreichen).

Alt-Cover bekam jetzt nach demselben Prinzip einen Datei-Upload
(`handleAltCoverFiles`, Mehrfachauswahl erlaubt, pro Bild bis 480px
Breite und ~60.000 Zeichen komprimiert — etwas großzügiger als beim
Haupt-Cover, da Galerie-Bilder ruhig etwas größer sein dürfen) plus
`removeAltCoverInline` zum Entfernen einzelner hochgeladener Bilder.
Neues Buch-Feld `altCoversInline` (Array von Data-URLs), getrennt vom
bestehenden `altCovers` (das weiterhin automatisch per Drive-Sync aus
dem "Bilder/Alt-Cover"-Ordner befüllt wird). Beide Quellen werden beim
Anzeigen zu `effAltCovers` zusammengeführt (`(b.altCovers ||
[]).concat(b.altCoversInline || [])`), sodass die Galerie Bilder aus
beiden Wegen zeigt. Kein Backend-Redeploy nötig — reine
Frontend-Änderung, wie beim bestehenden Cover-Upload.

**Nächster logischer Schritt (noch nicht umgesetzt), falls gewünscht:**
Manuskript-Direkt-Upload ist deutlich aufwändiger als Cover/Alt-Cover,
weil Manuskripte zu groß für die Data-URL-in-Sheet-Zelle-Methode sind
(Sheet-Zellen sind auf ca. 50.000 Zeichen gedeckelt) — dafür wäre
tatsächlich ein neuer Backend-Endpunkt nötig, der Datei-Bytes annimmt
und direkt als echte Datei in den passenden Drive-Unterordner
(`Manuskript/<Sprachcode>/`) mit korrektem `FINAL_`/`ENTWURF_`-Namen
ablegt.

**Wichtige Lehre aus diesem Patch-Durchgang:** Mehrere aufeinander-
folgende `json.loads()`/`json.dumps()`-Editier-Durchgänge im selben
Bearbeitungs-Schritt heben die `</script>`-Absicherung aus §36 JEDES
MAL wieder auf (siehe §37) — deshalb ab jetzt: alle Änderungen an
Manifest/Template-Inhalt in EINEM einzigen Python-Skript sammeln und
`re.sub(r'</script', r'<\\/script', ..., re.IGNORECASE)` erst ganz am
Ende, unmittelbar vor dem Zurückschreiben, ein einziges Mal anwenden —
nicht nach jedem einzelnen Zwischenschritt.

## 39 · Nachtrag (17.09.2026, Teil 3) — Manuskript/Klappentext direkt vom Gerät hochladen (echte Drive-Datei, neuer Backend-Endpunkt)

Ausbau von §38 (Alt-Cover-Direkt-Upload) auf Manuskript und Klappentext,
auf expliziten Nutzerwunsch: "beide Möglichkeiten sollen möglich sein,
die aktuelle und die per Handy" — der bisherige Weg (Datei selbst in
Drive hochladen, dann Link/Ordnerstruktur von Hand anlegen) bleibt
unverändert bestehen, der neue Weg kommt als Alternative dazu.

**Unterschied zu §38 (Cover/Alt-Cover):** Cover/Alt-Cover werden als
Data-URL direkt im Buch-Datensatz gespeichert (kein Drive, kein neuer
Endpunkt nötig) — für Manuskripte funktioniert das NICHT, weil a) Dateien
zu groß für eine Sheet-Zelle wären (~50.000-Zeichen-Deckel) und b) der
komplette Sinn ist, dass der BESTEHENDE Drive-Sync (Wortzahl-Zählung,
EPUB-Erzeugung, Klappentext-Übernahme — alles in `syncDriveForAllBooks`)
die Datei automatisch findet und verarbeitet, genau wie bei manuell in
Drive hochgeladenen Dateien. Das erfordert eine ECHTE Drive-Datei am
richtigen Ort mit korrektem Namen.

**Neuer Backend-Endpunkt `uploadBookFile`** (`Code.gs`): nimmt
Base64-codierte Datei-Bytes entgegen (`bookTitle`, `langCode`, `kind`
∈ {FINAL, ENTWURF, KLAPPENTEXT}, `fileName`, `mimeType`, `fileData`),
legt sie über die bestehenden Helfer `ensureBookFolders`/
`getOrCreateSubfolder`/`findFileByPrefix` im richtigen
`Manuskript/<Sprachcode>/`-Unterordner ab, mit dem erwarteten
`FINAL_`/`ENTWURF_`/`KLAPPENTEXT_`-Namenspräfix (Dateiendung vom
Original übernommen). Eine vorher vorhandene Datei mit demselben
Präfix wird zuerst in den Papierkorb verschoben (sonst würde
`findFileByPrefix` beim nächsten Sync zufällig irgendeine der
mehreren gleich-präfigierten Dateien nehmen). Ruft danach direkt
`syncDriveForAllBooks()` auf, damit Wortzahl/EPUB/Klappentext sofort
aktualisiert werden, statt auf den nächsten Stunden-Trigger zu warten
— ein Sync-Fehler wird separat im Ergebnis als `syncError` mitgegeben,
lässt den erfolgreichen Upload selbst aber nicht als fehlgeschlagen
erscheinen.

**Datei-Typ-Unterstützung:** `docTextById` (bereits bestehend) liest
sowohl Google Docs als auch `.docx`/`.doc` (per Kopie+Konvertierung)
sowie reinen Text/Markdown — ein direkt vom iPhone hochgeladenes Word-
Dokument funktioniert also ohne weitere Anpassung.

**Frontend:** neuer Abschnitt im Buch-Bearbeiten-Formular, direkt unter
dem bestehenden Manuskript-Link-Feld: Sprachcode-Eingabe, Fertig/Entwurf-
Auswahl (zwei Buttons + Text-Label, siehe Hinweis unten zu `<select>`),
und je ein Datei-Upload-Feld für Manuskript und Klappentext. Transiente
Upload-UI-Werte (Sprachcode, Auswahl, Lade-Status, Erfolgsmeldung) liegen
bewusst in einem SEPARATEN State-Objekt (`s.uploadState`, keyed nach
Buch-Index) statt in `bookForms[i]` — letzteres wird beim Speichern 1:1
in den Buchdatensatz übernommen und hätte die transienten Upload-Felder
ungewollt mit persistiert.

**Zwei Stolpersteine, live beim Bauen gefunden und korrigiert, bevor
irgendetwas deployt wurde:**
1. `<select>` wurde in dieser App bisher NIRGENDS verwendet — dieses
   custom Templating-System (`sc-camel-*`) hat für Formularelemente
   bislang nur mit `<input>`/`<button>`/Checkboxen gearbeitet, ein
   kontrolliertes `<select value="{{ ... }}">` hätte unter Umständen
   nicht zuverlässig funktioniert (kein React, keine Garantie für
   diese spezielle Bindungsart). Durch zwei Buttons ersetzt — exakt
   dasselbe Muster, das im Rest der App bereits erprobt ist.
2. Ein inline-Ternary DIREKT im `style="..."`-Attribut
   (`background:{{ book.x }} ? var(--gold) : none;`) — funktioniert in
   diesem DSL nicht, weil `{{ }}` nur Werte einsetzt, keine
   JS-Ausdrücke im umgebenden String auswertet. Die Lehre aus §30
   nochmal bestätigt: solche Berechnungen IMMER vollständig in der
   `bookRows`-JS-Berechnung vorwegnehmen (z.B. `mark: cond ? 'a' :
   'b'`) und im Template nur noch `{{ book.mark }}` einsetzen, nie
   Ternarys ins Template selbst schreiben.

Beide vor dem Deploy per BeautifulSoup + `json.loads()` (Pflichttest
aus §36/§37) sowie `node --check` auf den extrahierten App-Code
gefunden bzw. verifiziert.

**Kein Backend-Redeploy automatisch** — die `Code.gs`-Änderung
(`uploadBookFile`-Endpunkt) muss dem Nutzer wie gewohnt als Datei
bereitgestellt und von ihm im Apps-Script-Editor eingefügt + neu
deployt werden.

## 40 · Nachtrag (17.09.2026, Teil 4) — metadata.json (Genre) ebenfalls direkt hochladbar

Ausbau von §39: `uploadBookFile` bekommt einen dritten `kind`-Wert
`METADATA`. Unterschied zu FINAL/ENTWURF/KLAPPENTEXT: `metadata.json`
liegt laut bestehender Genre-Erkennung (siehe Kommentar ab Zeile ~843 in
`Code.gs`) direkt im **Buch-Hauptordner** (`folders.bookFolder`), nicht
in einem Sprach-Unterordner — braucht also KEINEN Sprachcode, und der
Zieldateiname ist immer exakt `metadata.json` (kein
Präfix+Titel-Muster). Frontend: neues Upload-Feld "metadata.json fürs
Genre hochladen (kein Sprachcode nötig)" im selben Upload-Bereich wie
Manuskript/Klappentext. `uploadBookFile_()` überspringt die
Sprachcode-Pflichtprüfung für `kind === 'METADATA'`.

Gleicher Ablauf wie bei Manuskript/Klappentext: vorhandene Datei wird
zuerst in den Papierkorb verschoben (verhindert mehrere `metadata.json`
nebeneinander), danach automatischer Sync-Trigger. Backend-Redeploy
nötig — wird dem Nutzer als Datei bereitgestellt.

## 41 · Nachtrag (17.09.2026, Teil 5) — Fix: Wettlauf-Bug ließ Titel-Änderungen nach Upload scheinbar "zurückspringen"

Beim ersten Live-Test des neuen Upload-Features (§39/§40) durch den
Nutzer live nachvollzogen und behoben:

**Reproduziertes Problem:** Nutzer lud ein Manuskript für ein Buch hoch,
dessen Titel-Feld noch den Platzhalter "New Book" trug (Upload-Feature
verwendet den TITEL zur Zuordnung des Drive-Ordners — nicht die
interne Buch-ID). Datei landete entsprechend korrekt im Ordner
"New Book" (bestätigt im DriveSyncLog: 98.388 Wörter, 38 Kapitel EPUB).
Nutzer korrigierte danach den Titel auf "The Physician of Ashes" und
speicherte — das griff zunächst sichtbar (Titel korrekt auf der
öffentlichen Seite). Beim erneuten Öffnen des Bearbeiten-Formulars kurz
danach stand dort aber wieder "New Book".

**Ursache:** `uploadBookFile_()` rief nach jedem erfolgreichen Upload
automatisch `this.fetchBooks()` auf, um Wortzahl/EPUB im Admin-Panel
sofort sichtbar zu machen. Das ist ein klassischer Wettlauf
(race condition): läuft eine ZWEITE, unabhängige Anfrage (hier: der
Titel-Speichern-Klick, `persistBooks()`) zeitlich knapp VOR oder
während dieses automatischen Neuladens, kann `fetchBooks()` eine noch
nicht ganz aktuelle Serverkopie zurückbekommen und damit den gerade erst
gespeicherten Titel im Browser-Speicher wieder überschreiben — rein
visuell im Browser, NICHT in der Google-Sheet-Datenquelle selbst (die
serverseitige Speicherung war zu diesem Zeitpunkt bereits erfolgreich
durchgelaufen, wie der spätere Blick auf die Live-Seite bestätigte).

**Fix:** Das automatische `fetchBooks()` nach Upload-Erfolg entfernt.
Wortzahl/EPUB werden weiterhin serverseitig sofort aktualisiert
(unverändert), aber im Admin-Panel erst nach einem manuellen
Seiten-Reload sichtbar — der Erfolgshinweis sagt das jetzt auch explizit
dazu. Bewusst diese "unbequemere" Lösung statt eines ausgefeilteren
Merge-Mechanismus, weil Datenverlust/-verwirrung bei gleichzeitiger
Bearbeitung schwerer wiegt als ein zusätzlicher manueller Reload.

**Lehre:** JEDE Aktion, die im Hintergrund automatisch den gesamten
`books`-State neu vom Server laedt (nicht nur diese), traegt grundsaetzlich
dasselbe Wettlauf-Risiko gegenueber gleichzeitigen, noch unbestaetigten
lokalen Bearbeitungen -- bei kuenftigen Erweiterungen mit Bedacht
einsetzen, nicht routinemaessig nach jeder Mutation neu laden.

## 42 · Nachtrag (17.09.2026, Teil 6) — Fix: Formularfelder liefen wieder aus dem Bild (min-width:0 fehlte bei 2 Feldern)

Wiederholung des aus §27 bekannten Bug-Musters (dort schon einmal
gefixt, hier bei zwei WEITEREN/neueren Feldern übersehen): Ein
`<input>`/`<textarea>` als direktes Kind eines `display:grid`-Containers
braucht explizit `min-width:0` — ohne das gilt CSS Grids Standardregel
`min-width:auto`, wonach ein Grid-Item nie schmaler wird als sein
längster NICHT umbrechbarer Inhalt (ein Wort/Token ohne Leerzeichen).
Ein einzelnes sehr langes, leerzeichenloses Token (typischerweise die
Cover-Bild-Data-URL, wenn sie als Teil des `langsRaw`-JSON-Textfelds
für eine Sprachfassung mit eigenem Cover eingebettet ist) reicht, um
das gesamte Formular über den Bildschirmrand hinauszudrücken.

**Betroffen:** `langsRaw`-Textarea ("Mehrsprachige Fassungen") hatte
zwar `width:100%`/`box-sizing:border-box`, aber kein `min-width:0` —
zusätzlich `overflow-wrap:break-word; word-break:break-all` ergänzt,
damit ein einzelnes langes Token nötigenfalls auch INNERHALB des Feldes
umbricht, statt nur auf die Fensterbreite gedeckelt zu werden. Das
`pdfUrl`-Eingabefeld ("Read link") hatte überhaupt keine
Breiten-Deckelung (weder `width:100%` noch `min-width:0` noch
`box-sizing:border-box`) — komplett ergänzt, analog zu allen anderen
Feldern im selben Formular.

Die neuen Upload-Felder aus §39/§40 (Sprachcode, Fertig/Entwurf-Buttons)
sitzen in einem `display:flex; flex-wrap:wrap`-Container statt in
`display:grid` und sind davon nicht betroffen (Flex-Items mit
`flex-wrap` brechen stattdessen um, statt den Container zu sprengen).

**Lehre für künftige Formularfelder in dieser App:** JEDES neue
`<input>`/`<textarea>` als Grid-Kind IMMER mit `width:100%; min-width:0;
box-sizing:border-box;` versehen — unabhängig davon, ob der aktuelle
Inhalt lang genug ist, um das Problem sofort sichtbar zu machen (die
Cover-Data-URL zeigt es erst, wenn ein Buch tatsächlich ein
sprachspezifisches Cover per JSON gesetzt bekommt).

## 43 · Nachtrag (17.09.2026, Teil 7) — UNGELÖST: "The Physician of Ashes" zeigt Manuskript-Prolog statt Klappentext + veraltete Wortzahl, trotz korrekter Drive-Dateien und korrektem Sync-Log

**Status: offen, Fortsetzung morgen mit dem Nutzer geplant.** Live beim
Testen des Upload-Features (§39-42) aufgetreten, noch NICHT
abschließend gelöst — hier dokumentiert, damit eine künftige Session
nicht bei null anfängt.

**Beobachtung:** Nutzer lud für "The Physician of Ashes" (Sprache DE)
Manuskript und Klappentext korrekt hoch (per Drive-Ordner-Screenshot
bestätigt: genau je eine sauber benannte `FINAL_...docx` und
`KLAPPENTEXT_...docx`, keine Duplikate). `DriveSyncLog` bestätigt
korrekten Sync: "Sprachfassung aktualisiert (DE): 98388 Wörter". TROTZDEM
zeigt die öffentliche Buchseite (auch nach komplettem Reload, sogar in
einem frisch geöffneten Tab) weiterhin "251 Wörter" und als
Klappentext/Zusammenfassung den MANUSKRIPT-Prolog ("Final Master
Manuscript Prologue I have kept these papers...") statt des echten
Klappentexts.

**Bereits ausgeschlossen:**
- Browser-Cache/stale Anzeige (frischer Tab zeigt denselben falschen
  Zustand).
- Falsch benannte/doppelte Dateien in Drive (Ordner-Screenshot zeigt
  genau eine FINAL_- und eine KLAPPENTEXT_-Datei).
- Der in §41 gefixte Wettlauf-Bug (der betraf nur den Titel, nicht
  Hook/Wortzahl, und war zeitlich vor diesem Vorfall separat behoben).

**Aktuell wahrscheinlichste Hypothese (noch nicht verifiziert):** Bei
MEHREREN fertigen Sprachfassungen (`langs`) wird für die
Top-Level-Felder `b.hook`/`b.wordCount` (das, was auf der Buchkarte
OHNE aktiven Sprach-Umschalter angezeigt wird — siehe
`effHook`/`effWordCount` im Frontend, `pickSyncSourceLanguage` im
Backend) IMMER Englisch (`SYNC_PREFERRED_LANGUAGE = 'EN'`) bevorzugt,
falls eine EN-Fassung als "fertig" erkannt wird — unabhängig davon, ob
die DE-Fassung frischer/korrekter ist. Aus einem sehr frühen
Zwischenstand dieser Session (siehe DriveSyncLog-Zeilen unter dem
damaligen Titel "New Book", vor der Umbenennung) existiert
möglicherweise bereits ein **EN**-Sprachordner mit einer alten,
fehlerhaften Klappentext-Zuordnung (aus dem allerersten,
versehentlich vertauschten Upload-Versuch) — falls dieser EN-Ordner
noch existiert und als "fertig" erkannt wird, würde er die frisch
korrigierten DE-Werte für die Top-Level-Felder dauerhaft überschreiben/
verdecken, obwohl `b.langs.DE` selbst längst korrekt ist.

**Für die Fortsetzung morgen:**
1. Prüfen, ob unter "The Physician of Ashes → Manuskript" ein
   **EN**-Unterordner existiert (der Nutzer hatte bisher nur den
   DE-Unterordner gezeigt). Falls ja: Inhalt von dessen
   `KLAPPENTEXT_`-Datei prüfen — vermutlich der Übeltäter.
2. Diagnose-Logging wurde bereits verbessert (dieser Commit): ein
   erfolgreicher Klappentext-Import wurde bisher GAR NICHT geloggt
   (nur Fehler/Kürzungen) — jetzt wird bei jedem Sync-Lauf pro Sprache
   geloggt, was gelesen wurde (Dateiname, Zeichenzahl, ob übernommen),
   UND zusätzlich, welche Sprache als Top-Level-Quelle gewählt wurde
   und was sich dabei geändert hat. Sobald der Nutzer das aktualisierte
   `Code.gs` deployt hat und erneut synchronisiert (z.B. über "Jetzt aus
   Drive synchronisieren"), sollte `DriveSyncLog` die tatsächliche
   Ursache eindeutig zeigen.
3. Alternative/zusätzliche Diagnose: rohen `BooksData`-Zelleninhalt
   (Spalte B, JSON) für diese Buchzeile ansehen — zeigt `b.langs` mit
   allen Sprachschlüsseln direkt, unabhängig vom Log.
4. Falls Hypothese bestätigt: entweder den fälschlich vorhandenen
   EN-Ordner (falls er nur Garbage aus dem frühen Fehlversuch enthält)
   löschen/leeren, oder — als robusterer Fix — `pickSyncSourceLanguage`
   so anpassen, dass sie nicht stur "EN zuerst" nimmt, sondern die
   Sprache mit dem NEUESTEN Sync-Zeitstempel bevorzugt (noch nicht
   umgesetzt, da unklar, ob das der Nutzer-Erwartung entspricht —
   vorher mit dem Nutzer klären, was bei mehreren fertigen Sprachen
   "bevorzugt" bedeuten soll).

## 44 · Nachtrag (17.09.2026, Teil 8) — GELÖST: eigentliche Ursache war ein verwaister `b.langs.EN`-Eintrag, nicht ein noch existierender EN-Ordner

Der Nutzer hat die Hypothese aus §43 direkt widerlegt: **"Es gibt kein
EN Ordner unter Manuskript nur DE."** Das schließt einen aktuell
vorhandenen EN-Ordner als Ursache aus — zeigt aber gleichzeitig auf die
tatsächliche Ursache, denn sie liegt nicht im Drive-Dateisystem,
sondern im gespeicherten JSON-Feld `b.langs` selbst.

**Root Cause gefunden:** `syncDriveForAllBooks()` hat `b.langs` bisher
nur ERGÄNZT, nie bereinigt. Der Code baute `newLangs` immer als Kopie
des BESTEHENDEN `b.langs` (`Object.assign({}, b.langs || {})`) und
aktualisierte darin nur die Sprachcodes, die gerade als Ordner
gefunden wurden (`completedCodes`) — ein Sprachcode, dessen
Unterordner später komplett gelöscht wurde (oder nie zum aktuellen
Buch gehörte), blieb für immer unverändert in `b.langs` stehen.

Genau das ist hier passiert: beim allerersten, versehentlichen
Upload-Versuch (als der Buchtitel noch "New Book" hieß, siehe §-
Abschnitte zum Titel-Bug) wurde vermutlich ein `EN`-Sprachordner
angelegt und synchronisiert, BEVOR der Titel korrigiert wurde — dieser
Sync schrieb `b.langs.EN` mit (falschen/vertauschten) Werten in genau
diese Buchzeile. Der EN-Ordner selbst wurde später gelöscht/nie
korrekt befüllt (daher "kein EN-Ordner unter Manuskript" heute), aber
der VERWAISTE `b.langs.EN`-Eintrag blieb im JSON der Buchzeile
bestehen, weil kein Code-Pfad je verwaiste Sprachschlüssel entfernt
hat.

**Warum das die exakten Symptome erklärt:** Im Frontend (`index.html`)
gilt:
```js
const langCodes = (b.langs && typeof b.langs === 'object') ? Object.keys(b.langs) : [];
const activeLang = langCodes.length > 1 ? (s.activeBookLang[key] || langCodes[0]) : null;
const langInfo = activeLang ? (b.langs[activeLang] || {}) : null;
const effHook = (langInfo && langInfo.hook) || b.hook;
```
Da `b.langs` sowohl `EN` (stale) als auch `DE` (korrekt) enthielt, war
`langCodes.length === 2` → es wurde automatisch ein
Sprach-Umschalter angezeigt (obwohl nur DE tatsächlich existiert), und
`activeLang` fiel mangels gespeicherter Nutzerwahl auf
`langCodes[0]` zurück — je nach Einfüge-Reihenfolge der Objektschlüssel
(JS erhält Insertion-Order) war das der ZUERST geschriebene Schlüssel,
also sehr wahrscheinlich `EN` (weil er vor der DE-Korrektur zuerst in
`b.langs` geschrieben wurde). `effHook`/`effWordCount` griffen dann
direkt auf `langInfo` (= `b.langs.EN`, die alten falschen Werte) zu —
komplett unabhängig davon, dass die Top-Level-Felder `b.hook`/
`b.wordCount` (über `pickSyncSourceLanguage`) längst korrekt auf DE
zeigten. Das erklärt auch die frühere Beobachtung "es ist im Grunde
egal ob ich auf DE oder EN klicke, es bleibt die gleiche Sprache" —
vermutlich zeigte der Tab in beiden Fällen denselben (falschen)
aktiven Zustand, weil das Umschalten selbst nicht das eigentliche
Problem war.

**Fix (bereits umgesetzt, `reference/apps-script/Code.gs`,
`syncDriveForAllBooks()`):** direkt nach dem Aktualisieren der
fertigen Sprachen wird jetzt jeder Sprachcode aus `newLangs` entfernt,
für den `scanBookLanguages()` aktuell KEINEN Ordner mehr findet (egal
ob der Ordner nie existierte, gelöscht wurde, oder nur umbenannt
wurde) — nicht nur "nicht fertig", sondern komplett kein Ordner mehr:

```js
Object.keys(newLangs).forEach(function(code) {
  if (!langs[code]) {
    delete newLangs[code];
    changed = true;
    logDriveSync(logSheet, b.title, 'Verwaiste Sprachfassung entfernt (' + code + '): kein Manuskript-Ordner mehr vorhanden.');
  }
});
b.langs = newLangs;
```
(Die Zuweisung `b.langs = newLangs` läuft jetzt unconditional statt
nur `if (completedCodes.length)` — das ist sicher, weil dieser ganze
Block bereits durch `if (Object.keys(langs).length) { ... }` davor
geschützt ist, also nur läuft, wenn überhaupt mindestens ein
Manuskript-Unterordner existiert.)

**Nächster Schritt:** Das aktualisierte `Code.gs` (enthält sowohl
diesen Fix als auch das Diagnose-Logging aus §43) muss vom Nutzer noch
manuell im Apps-Script-Editor deployt werden (Speichern reicht nicht —
Deploy → Verwaltung der Bereitstellungen → Stift-Symbol → "Neue
Version" → Bereitstellen). Danach einmal "Jetzt aus Drive
synchronisieren" ausführen, dann sollte für "The Physician of Ashes"
in `DriveSyncLog` eine Zeile "Verwaiste Sprachfassung entfernt (EN):
..." erscheinen und die Buchseite korrekt nur noch DE zeigen (kein
Sprach-Umschalter mehr, korrekte 98388 Wörter, korrekter Klappentext).
Falls das JSON in der `BooksData`-Zelle vorher noch geprüft werden
soll (zur Bestätigung, dass `b.langs.EN` tatsächlich existierte), am
besten VOR dem nächsten Sync-Lauf ansehen, da der Fix diesen Beweis
sonst automatisch aufräumt.

## 45 · Nachtrag (17.09.2026, Teil 9) — Drive-Ordner beim Buch-Löschen automatisch aufräumen, Buch-ID statt Titel-Diffing

Anlass: Nutzer fragte nach §44 direkt weiter — wenn verwaiste
`b.langs`-Einträge schon Probleme machen, muss es dann nicht auch eine
Logik geben für den Fall, dass ein ganzes Buch im Admin-Panel gelöscht
wird? Antwort: ja, bisher gab es dafür gar nichts — `action=saveBooks`
überschreibt einfach das komplette `BooksData`-Array, der
Drive-Ordner (`/<Buchtitel>/...`) des gelöschten Buchs blieb für immer
als Karteileiche liegen. Nutzer wollte: automatisch in den
Drive-Papierkorb verschieben (nicht nur loggen, nicht endgültig
löschen).

**Kernproblem beim naiven Ansatz:** Bücher hatten bisher KEINE
stabile ID, nur den Titel. Ein reiner Titel-Diff ("Titel X war vorher
da, ist jetzt weg → löschen") hätte eine reine Umbenennung (die genau
in dieser Session bereits vorkam: "New Book" → "The Physician of
Ashes") fälschlich als Löschung erkannt und den frisch umbenannten,
weiterhin aktiven Buchordner in den Papierkorb verschoben — hätte also
selbst den §44-Vorfall verschlimmert statt ihn zu verhindern.

**Fix, `reference/apps-script/Code.gs`:**
- Jedes Buch bekommt beim Speichern eine dauerhafte `id`
  (`Utilities.getUuid()` serverseitig, falls noch keine vorhanden;
  `index.html`/`addBook()` vergibt zusätzlich clientseitig sofort eine
  ID bei Neuanlage, damit Umbenennungen auch INNERHALB derselben
  Sitzung — vor jedem Reload — korrekt per ID statt per Titel erkannt
  werden).
- Neue Helper (nahe `logDriveSync`): `getOrCreateSyncLogSheet_()`
  (Refactoring, jetzt auch von `syncDriveForAllBooks()` genutzt),
  `findBookFolderByTitle_()`, `trashBookFolderByTitle_()`,
  `renameBookFolderIfExists_()`.
- `action==='saveBooks'` vergleicht jetzt vor dem Überschreiben die
  IDs der alten (`getBooksArray()`) gegen die neuen Buchliste:
  - ID war vorher da, ist jetzt weg → Buch wurde gelöscht → zugehöriger
    Drive-Ordner (per altem Titel gefunden) wird in den Papierkorb
    verschoben, geloggt in `DriveSyncLog`.
  - ID existiert in beiden, aber Titel hat sich geändert → Buch wurde
    umbenannt → Drive-Ordner wird mit umbenannt (`folder.setName(...)`),
    NICHT gelöscht. Bei einer Titel-Kollision (es existiert bereits ein
    Ordner mit dem neuen Titel) wird bewusst nicht automatisch
    zusammengeführt, nur eine Warnung geloggt — ein automatisches Merge
    könnte sonst Dateien überschreiben.
  - Das komplette Drive-Aufräumen läuft in einem eigenen try/catch, das
    nie das eigentliche Speichern der Buchdaten blockiert (kritischer
    Pfad bleibt: Buchdaten landen immer in der Tabelle, Drive-Pflege ist
    nur Zusatz).
- `index.html`, `addBook()`: neues Buch bekommt beim Anlegen sofort
  `id: 'b_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)`
  (einfache, kollisionssichere Client-ID, kein `Utilities.getUuid()`-
  Äquivalent im Browser nötig für diesen Zweck). Alle anderen
  Codepfade (Bearbeiten, Speichern, Sprach-Umschalter-Berechnung etc.)
  spreaden Buch-Objekte generisch (`...b`), die `id` läuft also überall
  automatisch mit durch, ohne dass weitere Stellen angepasst werden
  mussten.
- Bereits bestehende Bücher ohne `id` (alle aktuell in `BooksData`)
  bekommen beim nächsten Speichern automatisch eine ID zugewiesen
  (serverseitig) — bis dahin werden sie beim Diffing einfach
  übersprungen (kein `id`-Feld vorhanden → kein falsches Löschen/
  Umbenennen-Signal), rein additiv, kein Migrationsschritt nötig.

**Wichtige Lektion für künftige Patches an `index.html`:** beim
zweiten Anlauf dieses Patches wurde versehentlich die
`</script`-Escape-Regel aus §36/§37 auf die GESAMTE Datei statt nur
auf die eine betroffene Zeile des JSON-Blobs angewendet — das hätte
die echten, unbundleten `<script>`-Tags im `<head>` (Service-Worker-
Registrierung, jsdelivr-Includes) kaputt escaped und wäre selbst zu
einem neuen Produktionsausfall geworden. Vor dem Schreiben per
BeautifulSoup-Vergleich (Manifest unverändert, neuer Codeschnipsel im
decodierten Template vorhanden, alter verschwunden) aufgefallen und
korrigiert, BEVOR committet wurde. **Ergänzung zur Methodik:** die
`</script`-Escape-Regel darf nur auf die tatsächlich betroffene Zeile
des JSON-Blobs angewendet werden, niemals auf den gesamten
Dateiinhalt — und nur, wenn der neu eingefügte Text überhaupt ein
`</script`-Vorkommen enthält (bei reinen JS-Codeergänzungen ohne
Skript-Tag-Referenzen, wie hier, ist der Schritt schlicht
überflüssig).

**Nächster Schritt:** `Code.gs` muss (zusammen mit dem Fix aus §44)
noch vom Nutzer manuell deployt werden.

## 46 · Nachtrag (18.09.2026) — Mobile Buch-Karussell + Sprung-Liste (analog Gedichte-TOC)

Anlass: bei 30+ Büchern wird die öffentliche Buchseite auf dem Handy sehr
lang. Nutzer wollte auf Mobilgeräten ein horizontales, swipebares
Karussell statt der langen vertikalen Liste, plus (wie bei den
Gedichten) eine klickbare Sprung-Liste, um direkt zu einem bestimmten
Buch zu springen, ohne durchscrollen/-swipen zu müssen.

**Umsetzung (`index.html`, alles CSS + bestehendes Bindungs-Muster,
keine neue JS-Bibliothek):**
- Neue Klasse `book-list-wrap` auf dem Grid-Container der Buchliste.
  Per `@media (max-width:640px)` wird daraus auf dem Handy ein
  horizontal scrollendes Flexbox-Karussell mit CSS
  `scroll-snap-type:x mandatory` (native Swipe-Snap-Mechanik, keine
  JS-Bibliothek nötig). Desktop bleibt unverändert beim bestehenden
  CSS-Grid.
- Jede Buchkarte (Einzelbuch UND Serien-Karte) bekommt die Klasse
  `book-card` (Karussell-Breite: `flex:0 0 86vw; max-width:360px`
  nur im Mobile-Media-Query) sowie eine eindeutige `id`
  (`book-card-<encodeURIComponent(title)>`) als Sprungziel.
- Neues `anchorId`-Feld pro Buch (berechnet aus dem Titel, siehe
  `bookRows`-Aufbau) — für Bücher innerhalb einer Buchreihe wird die
  `id` auf dem inneren Pro-Band-Element gesetzt (nicht auf der
  äußeren Serien-Karte), damit jeder Titel individuell anspringbar
  bleibt.
- Neue Sprung-Liste-UI neben dem bestehenden Suchfeld: Button
  "{{ ui.jumpTo }}" (Klick, kein `:hover` — exakt aus demselben Grund
  wie beim bereits bestehenden Gedichte-TOC bewusst weggelassen, siehe
  Kommentar dort: Hover blieb auf dem PC lästig hängen, wenn die Maus
  nur zufällig in der Nähe war) öffnet ein Panel mit ALLEN sichtbaren
  Buchtiteln (`bookTocEntries`, aus `visibleBooksSourceRaw` — bewusst
  UNABHÄNGIG von der aktuellen Sucheingabe, damit die Sprung-Liste
  immer vollständig bleibt). Klick auf einen Titel ruft
  `jumpToBook(anchorId)` auf: schließt das Panel und scrollt per
  `element.scrollIntoView({ behavior: 'smooth', block: 'center' })`
  zur Karte — funktioniert in der Desktop-Grid-Ansicht genauso wie im
  Mobile-Karussell (dort scrollt es horizontal in den sichtbaren
  Bereich).
- Neue CSS-Klassen `.book-toc-wrap`/`.book-toc-panel`/
  `.book-toc-open` (hellem Buch-Bereich angepasste Variante der
  bestehenden `.poem-toc-*`-Klassen aus dem dunklen Gedichte-Bereich),
  plus ein zweiter `click`-außerhalb-schließt-Listener in
  `componentDidMount` (analog zum bestehenden für `.poem-toc-wrap`).
- Neuer State: `bookTocOpen` (boolean). Neue Methoden:
  `toggleBookToc`, `jumpToBook(anchorId)`.

**Methodik-Hinweis für künftige `index.html`-Patches:** bei diesem
Patch wurde erstmals konsequent NICHT versucht, die
JSON-escaped-Rohzeile direkt per String-Ersetzung zu bearbeiten
(siehe die verworfenen Fehlversuche mit `\n`/`\u`-Python-String-
Escapes in der Session vor diesem Patch) — stattdessen: Template-Inhalt
per `BeautifulSoup(...).get_text()` + `json.loads()` EINMAL in reinen
Klartext dekodieren (echte Zeilenumbrüche, echte Unicode-Zeichen, keine
Escape-Fallen mehr), ALLE Änderungen darauf als normale, einfache
String-Operationen anwenden, dann EINMAL am Ende per
`json.dumps(text, ensure_ascii=True)` zurück-encodieren und erst ganz
zum Schluss die `</script`-Escape-Regel (§36/§37) auf das neu erzeugte
JSON-Literal anwenden (niemals auf die gesamte Datei). Dieser
Decode-Edit-Reencode-Ansatz ist deutlich robuster als das Basteln von
alten/neuen Rohzeilen-Substrings mit manueller `\n`/`\"`-Maskierung und
sollte der Standardweg für alle künftigen, mehrzeiligen
`index.html`-Patches sein.

**Verifiziert:** Manifest unverändert, dekodierter Template-Inhalt
exakt wie beabsichtigt (`tmpl_json_after == text`-Vergleich), Datei
lädt in einer Headless-Browser-Probe (Playwright) ohne JS-Fehler bis
zum Zugangscode-Screen (weiter kam der Test mangels Zugangsdaten in
dieser Sandbox nicht — der eigentliche Karussell-/Sprunglisten-Teil
liegt hinter dem Zugangscode und muss vom Nutzer live geprüft werden).

## 47 · Nachtrag (18.09.2026) — Listen/Karussell-Umschalter + metadata.json akzeptiert beliebige Dateinamen

Nutzer-Feedback nach §46 (Karussell hat live funktioniert): zwei
Wünsche.

**1. Manueller Umschalter zwischen Karussell und Liste (`index.html`):**
Manche Leser wollen lieber scrollen statt swipen. Neuer Button
"{{ bookViewToggleLabel }}" (nur auf dem Handy sichtbar, per CSS
`@media (max-width:640px)`), togglet `bookMobileListMode`
(State, Default `false` = Karussell bleibt Standard). Wirkt über eine
neue CSS-Klasse `.book-list-wrap.list-mode`, die die
`scroll-snap`/Flex-Regeln aus §46 innerhalb desselben Media-Queries
wieder auf eine normale gestapelte Liste zurücksetzt — Desktop
unangetastet (Grid war dort nie betroffen).

**Bug beim ersten Anlauf, noch vor dem Commit gefangen:** die neue
`bookViewToggleLabel`-Berechnung (`ui.viewAsCarousel`/`ui.viewAsList`)
wurde versehentlich VOR der Definition von `const ui = uiStrings[...]`
eingefügt (gleicher `renderVals()`-Scope, aber falsche Reihenfolge) —
das ergibt einen `ReferenceError: Cannot access 'ui' before
initialization` (JS `const`/`let` TDZ), der die GESAMTE Seite zum
Absturz gebracht hätte (React-Rendermethode wirft, nichts rendert
mehr). Eine Playwright-Kopfstartprobe gegen die lokal gepatchte Datei
(vor jedem `index.html`-Commit jetzt Standard-Praxis, siehe
`body.innerText` auf Fehlermeldungen statt nur "kein JS-`pageerror`"
prüfen) hat das direkt gezeigt: `body.innerText` war die Fehlermeldung
selbst statt "Private page/ENTER". Fix: Berechnung an die richtige
Stelle (direkt nach `const ui = ...`) verschoben, erneut geprüft —
lädt jetzt wieder normal bis zum Zugangscode-Screen. **Lektion:**
`pageerror`-Events allein reichen nicht als Test — manche Fehler
schlagen erst beim tatsächlichen Rendern zu und zeigen sich nur im
sichtbaren Seiteninhalt (`body.innerText`), nicht als Browser-Konsolen-
Fehler.

**2. metadata.json akzeptiert jetzt beliebige Dateinamen
(`reference/apps-script/Code.gs`):** bisher musste die Genre-Datei im
Buch-Wurzelordner exakt `metadata.json` heißen (`findFileByPrefix`
mit festem Präfix). Nutzer nutzt einen separaten
Buch-Vorbereitungs-Workflow, der die Datei ggf. mit dem Romantitel im
Dateinamen benennt (z.B. "Der Titel des Romans.json"). Neue Funktion
`findMetadataJsonFile_(folder)`: akzeptiert JEDE `.json`-Datei im
Buchordner (Endung statt Präfix/exaktem Namen), unabhängig vom
restlichen Dateinamen — bei mehreren `.json`-Dateien zählt die zuletzt
geänderte. Der Ordner ist ohnehin schon pro Buch getrennt, eine feste
Namenskonvention brachte hier nie einen echten Vorteil. Wird sowohl
beim Sync-Lesen (`syncDriveForAllBooks`) als auch beim
Ersetzen-vor-erneutem-Upload in `action==='uploadBookFile'` (Kind
METADATA) verwendet.

**Nächster Schritt:** `Code.gs` muss (zusammen mit den Fixes aus §44/§45)
noch vom Nutzer manuell deployt werden. Das Frontend-Update (Toggle) ist
wie gehabt automatisch live über GitHub Pages, sobald gemerged.

## 48 · Nachtrag (19.09.2026) — Fertige EPUB-Datei akzeptieren (anstelle eines Manuskript-Dokuments)

Nutzer-Wunsch: manche Bücher liegen schon als fertige EPUB vor (aus
einem anderen Workflow) — das System sollte diese direkt akzeptieren
können, statt zwingend ein Word/Google-Doc-Manuskript zu verlangen,
aus dem es selbst eine EPUB baut.

**Umsetzung (`reference/apps-script/Code.gs`):**
- Neuer Upload-Kind `EPUB` (neben FINAL/ENTWURF/KLAPPENTEXT/METADATA)
  in `action==='uploadBookFile'` — landet wie FINAL_/ENTWURF_ im
  Sprach-Unterordner (`EPUB_<Titel>.epub`), braucht also weiterhin
  einen Sprachcode.
- `scanBookLanguages()`: neues Feld `epubReadyFile`
  (`findFileByPrefix(langFolder, 'EPUB_')`). Status wird jetzt auch
  ohne `FINAL_`-Datei "fertig", wenn eine `EPUB_`-Datei existiert.
- `syncDriveForAllBooks()`: wenn kein `FINAL_`-Dokument vorliegt, aber
  eine `EPUB_`-Datei, wird (a) die Wortzahl per neuer Funktion
  `epubTextExtract_(fileId)` grob aus dem EPUB-Textinhalt geschätzt
  (EPUB ist einfach ein ZIP, `Utilities.unzip()` entpackt es direkt,
  Tags aus allen `.xhtml`/`.html`-Dateien werden entfernt — kein
  Anspruch auf exakte Wortzahl, nur fürs Anzeige-Badge) und (b) die
  hochgeladene EPUB unverändert als `entry.epubUrl` übernommen
  (`epubDownloadUrlFor_`), statt selbst eine per `buildEpub_` zu
  bauen. Liegt zusätzlich ein `FINAL_`-Dokument vor, hat das weiterhin
  Vorrang (Doc-basierter Bau bleibt wie bisher) — die EPUB-Datei ist
  eine Alternative, kein Override.

**`index.html`:** neues Datei-Upload-Feld "Fertige EPUB-Datei (statt
Manuskript-Dokument, falls schon vorhanden)" neben dem bestehenden
Klappentext-Upload, ruft `uploadBookFile_(i, 'EPUB', file,
'epubReadyBusy')` auf — gleiches Muster wie die bestehenden
Upload-Felder, kein neuer Code-Pfad nötig.

**Verifiziert:** Manifest unverändert, Template-Diff exakt wie
beabsichtigt, `node --check` auf `Code.gs` grün, Playwright-Probe lädt
weiterhin fehlerfrei bis zum Zugangscode-Screen.

**Nächster Schritt:** `Code.gs` erneut deployen (enthält jetzt auch
diesen Fix zusammen mit §44/§45/§47).

## 49 · Nachtrag (19.09.2026, Teil 2) — Fortschrittsanzeige beim Datei-Upload (`index.html`)

Nutzer-Wunsch: gerade EPUB-/Manuskript-Uploads vom Handy (oft auf
Mobilfunknetz, Dateien mehrere MB groß) zeigten bisher nur einen
statischen "wird hochgeladen…"-Text ohne jedes Feedback, wie weit der
Upload tatsächlich ist.

**Nur `index.html`, kein Backend-Änderung nötig** — `uploadBookFile_()`
lief bisher über `fetch()`, das keinen Zugriff auf den Upload-Fortschritt
bietet (nur auf den fertigen Response). Umgestellt auf `XMLHttpRequest`
mit `xhr.upload.onprogress`: bei jedem Fortschritts-Event wird, falls
`lengthComputable`, ein neues `progress`-Feld im bestehenden
`uploadState[i]`-Objekt auf den gerundeten Prozentsatz gesetzt (gleiches
`setUploadField`-Muster wie die bestehenden Busy-Flags). Response-Handling
(`data.ok`/`data.error`/Netzwerkfehler) blieb inhaltlich unverändert, nur
von `.then((r) => r.json())` auf `xhr.onload`/`JSON.parse` umgestellt, da
XHR kein eingebautes Promise-Interface hat. `progress` wird vor jedem
Upload auf `0` gesetzt und nach Abschluss (Erfolg, Fehler-Response oder
Netzwerkfehler) wieder auf `0` zurückgesetzt.

Betrifft **alle vier** Upload-Felder gleichermaßen (sie teilen sich
`uploadBookFile_`): Manuskript, Klappentext, `metadata.json`, fertige
EPUB-Datei (§48). Die vier bestehenden `sc-if`-Spinner-Texte im
Admin-Panel zeigen jetzt zusätzlich `{{ book.upload.progress }}%` an,
z. B. "EPUB wird hochgeladen… 42%".

**Verifiziert:** JSON-Parse der `__bundler/template`-Zeile grün,
`node --check` auf die extrahierte Component-Klasse grün, alle vier
Template-Stellen sowie die neue `XMLHttpRequest`-Umstellung per gezielter
String-Ersetzung eingefügt (kein freihändiges Retippen). Kein Playwright
in dieser Sandbox verfügbar (Paket nicht installiert) — Live-Test des
tatsächlichen Fortschrittsbalkens beim Hochladen einer echten Datei vom
Handy steht noch aus.

## 50 · Nachtrag (19.09.2026, Teil 3) — KI-generierter Klappentext beim EPUB-/Manuskript-Upload

Nutzer-Wunsch: Wenn eine EPUB (oder ein Manuskript) hochgeladen wird und
noch kein Klappentext existiert, soll automatisch ein Klappentext-Entwurf
erzeugt werden — "Weltklasse", spannungserzeugend, nach Bestseller-
Best-Practices, gemäß dem eigenen Stilstandard des Autors. Als Referenz
zwei hochgeladene Dokumente ausgewertet: `AJ_Khan_Novel_Master_Standard
_v5_0.docx` (Schreibstandard) und `AJ_Khan_Literary_Constitution_v3_3
_fixed.docx` (enthält keine Klappentext-/Backcover-Vorgaben — betrifft
Canon-/Konsistenzregeln der Romane selbst, nicht Marketing-Text; daher
nicht in den Prompt eingeflossen). Der Master Standard enthält keine
fertige Klappentext-Formel, nur die generelle Tonalitäts-Leitlinie
"Propulsion ohne Thrillerisierung" (nicht jedes Buch braucht Countdown/
Leiche/Chase — Neugier, Intimität, Scham, Pflicht, Beziehung, Entdeckung
oder Konsequenz ziehen genauso stark wie Gefahr) plus die Forderung, dass
Titel/Opening/Cover/Blurb/Comp-Titel demselben Leser dasselbe
Leseerlebnis versprechen müssen. Ergänzt um branchenübliche Backcover-
Konventionen kommerzieller Bestseller (destilliert, keine Zitate aus
fremden Büchern): starker Einstiegshaken, Hauptfigur + auslösendes
Ereignis, eskalierender Konflikt/Einsatz, offenes Ende ohne Twist-Verrat,
aktive statt zusammenfassende Sprache, keine Klischees, ~120–180 Wörter.

**Nur `reference/apps-script/Code.gs`, kein Frontend-Änderung nötig** —
der Trigger ist bereits vorhanden: `uploadBookFile` (EPUB/FINAL/ENTWURF)
ruft direkt nach dem Ablegen der Datei `syncDriveForAllBooks()` auf
(siehe §48). Neue Logik dort, pro fertiger Sprache:

- **Neue Funktion `generateBlurbWithAI_(manuscriptText, bookTitle, genre,
  langCode)`** — ruft die **Google-Gemini-API** (`https://
  generativelanguage.googleapis.com/v1beta/models/<Modell>:
  generateContent`) per `UrlFetchApp` auf, mit dem oben destillierten
  Stil-Prompt (sprachbewusst: DE/EN/BS) als `systemInstruction`, max. 700
  Output-Tokens, Modell konfigurierbar über die neue Script Property
  `GEMINI_MODEL` (Default `gemini-2.5-flash`).
  **Ohne die neue Script Property `GEMINI_API_KEY` bleibt die Funktion
  ein reines No-op** (kein Fehler, kein API-Aufruf).
  **Bewusst Gemini statt Anthropic gewählt** (Nutzer-Nachfrage: "geht es
  nicht ohne API-Key, wie Claude Code, oder mit einer Gratis-KI wie
  Gemini/DeepSeek/Qwen?"): ein Server-Aufruf braucht immer irgendeinen
  Schlüssel — Claude Code selbst authentifiziert sich im Hintergrund
  genauso, nur unsichtbar über das eigene Abo. Google AI Studio
  (`aistudio.google.com/apikey`) vergibt aber einen **echten
  Gratis-API-Key ohne Kreditkarte** mit großzügigem Tageslimit, passend
  zur ohnehin komplett auf Google-Infrastruktur laufenden Automatisierung
  hier (Drive/Sheets/Apps Script). DeepSeek/Qwen wurden verworfen: beide
  API-Key-pflichtig, aber ohne dauerhaften Gratis-Tarif wie Gemini (nur
  Test-Guthaben).
- **Wo es greift:** in `syncDriveForAllBooks()`, im bestehenden
  Klappentext-Block pro Sprache — nur im `else`-Zweig, wenn **keine**
  `KLAPPENTEXT_`-Datei gefunden wurde. Nimmt `blurbSourceText` (Volltext
  aus `FINAL_`-Dokument oder, falls kein Dokument vorliegt, aus der
  direkt hochgeladenen `EPUB_`-Datei über das bestehende
  `epubTextExtract_`) und schickt ihn komplett (bis 400 000 Zeichen
  Deckel, reiner Ausreißer-Schutz, kein bewusstes Kürzen auf "nur den
  Anfang" — Geminis Kontextfenster trägt ganze Romane) an die API.
- **Neues Feld `entry.hookSource`** (`'file'` oder `'ai'`) pro
  Sprachfassung in `b.langs[code]`: markiert, woher der aktuelle
  Klappentext kommt. Eine manuell hochgeladene `KLAPPENTEXT_`-Datei setzt
  `hookSource='file'` und hat **für immer Vorrang** — der KI-Vorschlag
  wird nie über einen vom Autor selbst geschriebenen/hochgeladenen
  Klappentext geschrieben, auch nicht bei künftigen Syncs. Alte Einträge
  ohne dieses Feld (vor §50) heilen sich beim nächsten Sync automatisch:
  liegt eine `KLAPPENTEXT_`-Datei vor, wird `hookSource` nachträglich auf
  `'file'` gesetzt.
- **Neues Feld `entry.hookSourceHash`** (MD5 von `blurbSourceText`):
  verhindert, dass bei jedem stündlichen Sync erneut ein API-Aufruf
  passiert, solange sich das Manuskript/die EPUB nicht geändert hat.
  Ändert sich der Text (neue Fassung hochgeladen) und es liegt weiterhin
  keine `KLAPPENTEXT_`-Datei vor, wird automatisch neu generiert.
- **Kein Override eines bereits gesetzten manuellen Textes über den
  Admin-Formular-Weg möglich, ohne eine Datei hochzuladen** — das war
  aber schon vor §50 so: das `hook`-Formularfeld im Admin-Panel wird bei
  jedem Sync von `sourceEntry.hook` überschrieben, sobald dieses einen
  Wert hat (bestehendes Verhalten, nicht neu). Will der Autor einen
  KI-Vorschlag verwerfen/ersetzen, muss er wie gehabt eine eigene
  `KLAPPENTEXT_`-Datei hochladen — kein neuer Endpunkt nötig.

**Nötiger manueller Schritt für den Nutzer (zwingend, sonst inaktiv):**
1. Kostenlosen Gemini-API-Key beschaffen: `aistudio.google.com/apikey`
   (mit dem gleichen Google-Konto, das auch Drive/Apps Script nutzt) —
   kein Kreditkarten-Zwang für den Gratis-Tarif.
2. Im Apps-Script-Editor unter **Projekteinstellungen → Script Properties**
   eine neue Property `GEMINI_API_KEY` mit dem Key als Wert anlegen
   (niemals im Code selbst — wie beim bestehenden `ADMIN_PASSWORD`-Muster,
   Abschnitt 7). Optional zusätzlich `GEMINI_MODEL`, falls ein anderes
   Modell als der Default (`gemini-2.5-flash`) gewünscht ist.
3. `Code.gs` erneut per "New version" deployen (siehe Abschnitt 7 — enthält
   jetzt §48/§49/§50 zusammen).

**Verifiziert:** `node --check` auf die vollständige `Code.gs`-Datei grün.
**Nicht getestet in dieser Session** (kein API-Key verfügbar, kein
Netzwerkzugriff auf `generativelanguage.googleapis.com` aus dieser
Sandbox möglich): der tatsächliche API-Roundtrip, Tonalität/Qualität der
generierten Klappentexte gegen ein echtes Manuskript, und ob
Antwortlänge/-format bei allen Genres stabil den Vorgaben (120–180
Wörter, kein Markdown) folgt. Sollte vom Nutzer nach dem Deploy an einem
echten Buch ohne Klappentext geprüft werden — bei Bedarf lässt sich der
Stil-Prompt in `generateBlurbWithAI_` direkt nachschärfen, ohne an der
Trigger-/Vorrang-Logik etwas zu ändern. Gemini-Tageslimit des Gratis-
Tarifs kann sich ändern — bei `429`/Quota-Fehlern wirft die Funktion
einen Fehler, der geloggt wird (`logDriveSync`), der Upload selbst
schlägt dadurch nicht fehl (siehe bestehendes `try/catch`-Muster im
Aufrufer).

## 51 · Nachtrag (19.09.2026, Teil 4) — Script-Properties-UI durch nie geleerte Admin-Tokens read-only geworden

Beim Versuch, `GEMINI_API_KEY` einzutragen: Nutzer-Screenshot zeigte
über 50 Script Properties, fast alle `admintoken_<uuid>`. Ursache
gefunden: jeder Admin-Login (`action==='checkPassword'`) erzeugt einen
neuen `admintoken_`-Eintrag (Abschnitt 7, 7 Tage Lebensdauer), aber
nichts hat abgelaufene Einträge je wieder gelöscht — reines Wachstum bei
jedem Login. Ab 50 Properties zeigt die Apps-Script-Oberfläche unter
Projekteinstellungen nur noch die ersten 50 an und schaltet komplett auf
**Lesemodus** — neue Properties lassen sich dann über die UI gar nicht
mehr anlegen, nur noch programmatisch. Das hat den eigentlichen
Vorhaben (Gemini-Key eintragen) live blockiert.

**Fix (`reference/apps-script/Code.gs`):** neue Funktion
`cleanupExpiredAdminTokens_()` — iteriert alle Script Properties, löscht
jeden `admintoken_`-Eintrag, dessen gespeicherter Zeitstempel älter als
`ADMIN_TOKEN_LIFETIME_MS` ist. Aufgerufen bei jedem erfolgreichen
Admin-Login, direkt vor der Ausgabe eines neuen Tokens — räumt sich damit
von selbst laufend auf, ohne separaten Cron/Trigger.

**Sofortiger manueller Schritt für den bereits bestehenden Rückstand**
(die UI selbst ist ja gerade gesperrt): im Apps-Script-Editor unter dem
Code-Tab (`<>`-Symbol) eine neue, temporäre Funktion einfügen, sie oben
im Dropdown neben "Debuggen" auswählen und über "Ausführen" **einmal**
laufen lassen — danach kann die Funktion wieder gelöscht werden:

```javascript
function _einmaligerAufraeumSchritt() {
  cleanupExpiredAdminTokens_();
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', 'DEIN_NEUER_KEY_HIER');
}
```

Danach ist die Properties-Liste wieder unter 50 Einträgen und in der UI
normal bearbeitbar (z. B. um den Wert später zu ändern), und
`GEMINI_API_KEY` ist gesetzt. Nach dem Ausführen den Platzhaltertext im
Code wieder durch Leerzeichen/Kommentar ersetzen oder die ganze Funktion
löschen, damit der Key nicht dauerhaft im Editor-Verlauf sichtbar
herumliegt (die Script-Property selbst bleibt davon unberührt).

**Verifiziert:** `node --check` grün. **Nicht getestet:** der reale
Effekt auf die Apps-Script-Properties-UI (kein Zugriff auf das echte
Apps-Script-Projekt aus dieser Sandbox) — sollte sich nach dem nächsten
Admin-Login von selbst zeigen (Anzahl `admintoken_`-Einträge sinkt).

**Live durchgeführt (19.09.2026):** Nutzer hat `_setupGemini()` (Variante
mit `cleanupExpiredAdminTokens_()` + `setProperty('GEMINI_API_KEY', ...)`)
im Apps-Script-Editor ausgeführt — Execution log zeigte "Execution
completed" ohne Fehler. `GEMINI_API_KEY` ist damit gesetzt, alte
`admintoken_`-Einträge aufgeräumt. Temporäre Funktion anschließend wieder
entfernt, `Code.gs` neu deployt.

## 52 · Nachtrag (19.09.2026, Teil 5) — Buchtitel automatisch aus EPUB-Metadaten übernehmen

Nutzer-Wunsch: Beim Hochladen einer fertigen EPUB-Datei (§48) soll der
Buchtitel nicht mehr von Hand eingetragen werden müssen, solange er noch
leer oder noch der Default `"New Book"` ist (siehe `addBook` in
`index.html` — ein neu angelegtes Buch bekommt sofort diesen Platzhalter-
titel statt eines leeren Strings, daher die Prüfung auf beide Fälle).

**Backend (`reference/apps-script/Code.gs`):**
- Neue Funktion `epubTitleFromBytes_(bytes)` — entpackt die EPUB-Bytes
  direkt per `Utilities.unzip()` (kein vorheriges Speichern in Drive
  nötig, anders als bei `epubTextExtract_`, das eine Drive-Datei-ID
  braucht), findet die `.opf`-Datei (Endung statt festem Namen, gleiches
  Prinzip wie `findMetadataJsonFile_`) und liest `<dc:title>` per Regex
  aus. Neuer kleiner Helfer `decodeXmlEntities_` für die Handvoll in
  Buchtiteln realistisch vorkommender XML-Entities (`&amp;`, `&#39;` etc.).
- Neue Aktion `detectEpubTitle` (admin-geschützt wie `uploadBookFile`) —
  nimmt `fileData` (Base64, wie bei `uploadBookFile`) entgegen, schreibt
  **nichts** nach Drive (reine Vorab-Leseaktion), gibt `{ ok: true, title:
  '...' }` zurück (leerer String, falls keine `dc:title` gefunden wurde).

**Frontend (`index.html`):**
- Neue Methode `detectAndUploadEpub_(i, file)` — liest die Datei wie
  gehabt per `readFileAsBase64_`, ruft `detectEpubTitle` auf; bei
  gefundenem Titel: aktualisiert sowohl `state.books[i].title` als auch
  das offene Bearbeitungsformular (`bookForms[i].title`, damit das
  Titel-Feld sofort den neuen Wert zeigt, falls der Admin gerade im
  Bearbeiten-Modus ist), ruft `persistBooks()` auf (Titel landet sofort
  im Sheet, nicht erst nach manuellem "Speichern") und startet danach
  automatisch den eigentlichen Upload (`uploadBookFile_(i, 'EPUB', ...)`)
  — der greift jetzt, weil `b.title` nicht mehr leer/Default ist. Wird
  kein Titel gefunden: Hinweis-Dialog wie bisher ("bitte zuerst den
  Buchtitel eintragen"), kein Upload.
- `pickEpubReadyFile` prüft jetzt vor dem Upload den aktuellen (bereits
  gespeicherten) Buchtitel: leer oder `"New Book"` → `detectAndUploadEpub_`
  statt direkt `uploadBookFile_`. Hat das Buch bereits einen echten,
  vom Autor selbst vergebenen Titel, ändert sich am bisherigen Verhalten
  **nichts** — die Datei-Metadaten werden dann gar nicht erst abgefragt,
  ein bewusst gewählter Titel wird nie überschrieben.

**Bewusst nicht gebaut:** ein Upload-Weg, der ganz ohne vorher angelegten
Buch-Eintrag auskommt (erste Option aus der Rückfrage an den Nutzer) —
der Nutzer wollte stattdessen die zweite, kleinere Variante (Auto-Fill
im leeren Titel-Feld eines bestehenden Eintrags).

**Verifiziert:** JSON-Parse der `__bundler/template`-Zeile grün,
`node --check` auf `Code.gs` und auf die extrahierte Component-Klasse
grün, `b` (Buchobjekt) im Scope von `pickEpubReadyFile` bestätigt (andere
Zeilen im selben View-Model-Block referenzieren bereits `b.series` etc.).
**Nicht getestet:** der tatsächliche Roundtrip gegen eine echte EPUB-Datei
(kein Apps-Script-Zugriff aus dieser Sandbox) — insbesondere, ob das
Dateiformat-Präfix `.opf` bei allen gängigen EPUB-Erzeugern (Calibre,
Word-Export, Pandoc, Vellum …) zuverlässig zutrifft, und ob `dc:title`
dort immer ohne zusätzliche Namespace-Präfixe/Attribute vorkommt, die die
Regex verfehlen könnte. Sollte der Nutzer nach dem Deploy an einer echten
EPUB-Datei ohne Buchtitel prüfen.

## 53 · Nachtrag (19.09.2026, Teil 6) — Cover aus EPUB übernehmen + neue Bücher standardmäßig „fertig"

Nutzer-Nachfrage nach §52: Warum braucht es noch ein separates Cover,
wenn die EPUB doch eins eingebettet hat? Und: Der Status neuer Bücher
soll direkt auf „fertig" stehen, weil der ganze Workflow (Titel,
Wortzahl, Klappentext) jetzt ohnehin automatisch beim Upload passiert.

**1. Cover-Extraktion aus der EPUB (`reference/apps-script/Code.gs`):**
- Neue Funktion `epubCoverBlobFromFile_(file)` — findet das Cover-Bild
  über das EPUB3-Manifest-Attribut `properties="cover-image"`, mit
  Fallback auf das ältere EPUB2-Muster `<meta name="cover"
  content="ID"/>` + zugehöriges `<item id="ID" href="...">`. Attribute
  einzeln per kleiner Regex ausgelesen (nicht ein großes kombiniertes
  Muster), weil die Reihenfolge von `id`/`href`/`properties` zwischen
  Erzeuger-Tools (Calibre, Pandoc, Vellum, Word-Export) variiert. Der
  `href` wird relativ zum Ordner der `.opf`-Datei aufgelöst (EPUBs legen
  Bilder meist relativ dazu ab, z. B. `images/cover.jpg` von `OEBPS/`
  aus gesehen).
- **Wo es greift:** in `syncDriveForAllBooks()`, direkt nach dem
  Wortzahl-Block für eine hochgeladene `EPUB_`-Datei — **nur wenn noch
  kein Cover** im `Bilder/Cover`-Ordner liegt (`!coverFile`). Ein dort
  manuell abgelegtes Bild hat weiterhin immer Vorrang und wird nie
  ersetzt — die EPUB-Extraktion ist reiner Fallback für den Fall, dass
  noch gar kein Cover existiert. Gefundenes Bild wird als eigene Datei
  (`cover_from_epub.<ext>`) in den bestehenden `Bilder/Cover`-Ordner
  gelegt — läuft danach über exakt dieselbe Weiterverarbeitung
  (`firstImageFile`/`publicViewUrlFor`) wie jedes andere Cover, kein
  Sonderfall im Rest des Codes nötig.
- Kein Cover in der EPUB gefunden (z. B. weil das Manuskript ganz ohne
  Coverbild exportiert wurde) → bleibt wie bisher: kein Cover, bis der
  Autor eins über den bestehenden Weg (URL/Datei-Upload) einträgt.

**2. Neue Bücher standardmäßig „fertig" (`index.html`, `addBook`):**
`status` von `'In Entwicklung'` auf `'Fertig'`, **und** — das ist der
eigentlich wirksame Schalter — `isFinished` von `false` auf `true`.
Grund für beides: `bookIsFinished` im Frontend prüft `isFinished`
**zuerst** (`b.isFinished !== undefined ? !!b.isFinished : status
startsWith('fertig')`) — da `addBook` `isFinished` immer explizit setzt
(nie `undefined`), hätte eine reine Status-Text-Änderung ohne die
`isFinished`-Änderung **nichts** bewirkt, das EPUB/Read-Gate hängt
tatsächlich an `isFinished`, nicht am Freitext.

**Bewusste Kompromisse / Nebenwirkungen, mit denen der Nutzer einverstanden
war:** Ein neu angelegtes Buch gilt jetzt **sofort** als „fertig" und
erscheint so auf der öffentlichen Seite, auch bevor überhaupt ein
Manuskript/EPUB hochgeladen wurde — passend zum Nutzer-Workflow (Buch
anlegen, direkt EPUB hochladen), aber ein Buch, das absichtlich länger
als Entwurf unsichtbar bleiben soll, muss jetzt aktiv auf einen anderen
Status/`isFinished:false` zurückgestellt werden, statt es wie bisher
default so vorzufinden.

**Verifiziert:** JSON-Parse der `__bundler/template`-Zeile grün,
`node --check` auf `Code.gs` und die extrahierte Component-Klasse grün.
**Nicht getestet:** der tatsächliche Cover-Extraktions-Roundtrip gegen
eine echte EPUB-Datei (kein Apps-Script-Zugriff aus dieser Sandbox) —
insbesondere Pfad-Auflösung bei tief verschachtelten OEBPS-Strukturen
und ob alle gängigen Erzeuger-Tools durchgängig `properties="cover-
image"` setzen (ältere Calibre-Versionen z. B. nutzen teils nur das
EPUB2-`<meta>`-Muster, das als Fallback abgedeckt ist). Sollte der
Nutzer nach dem Deploy an einer echten EPUB ohne vorhandenes Cover
prüfen.
