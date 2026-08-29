# Anweisung für Claude Code: Stil-Revisions-Modul im Admin-Panel

## Kontext (zuerst lesen, bevor du etwas baust)

Dieses Repo enthält bereits eine Autoren-Website mit Admin-Panel (du selbst hast sie ursprünglich aufgesetzt). Bevor du irgendeinen Code schreibst:

1. **Inspiziere das bestehende Repo vollständig.** Stack, Ordnerstruktur, Auth-Mechanismus, Datenbank/Storage-Schicht, bestehende Admin-Routen, Styling-System, Deployment-Setup (GitHub Pages? Vercel? eigener Server?).
2. **Fasse deinen Befund in 5–10 Sätzen zusammen**, bevor du mit der Implementierung beginnst — insbesondere: Wie ist der Admin-Bereich aktuell aufgebaut, gibt es bereits eine Datenbank oder nur statische Dateien, wie werden aktuell Uploads (falls vorhanden) gehandhabt.
3. **Baue konsistent mit dem, was bereits da ist** — gleiche Konventionen, gleiches Styling-System, gleiche Auth-Logik. Erfinde keine Parallelarchitektur.

Wenn irgendein Punkt unten mit der bestehenden Architektur kollidiert (z. B. kein Backend vorhanden, nur Static Site), schlage mir *vor* der Implementierung eine angepasste Lösung vor, statt sie unangekündigt zu bauen.

## Ziel des Features

Ein neuer Bereich im Admin-Panel: **"Stil-Revision"**. Pro hochgeladenem Roman kann ich dort:

1. Ein Manuskript hochladen (docx/pdf/txt)
2. Ein eigenes Regelwerk (Style-Constitution, z. B. meine "Literary Constitution" + ggf. zusätzliche Guideline-Dateien) diesem Roman zuordnen — unterschiedliche Romane/Projekte haben unterschiedliche Regelwerke
3. Eine automatische, KI-gestützte Stilüberarbeitung **kapitelweise** durchlaufen lassen, mit Fortschrittsanzeige, Vorher/Nachher-Ansicht pro Kapitel und Änderungsliste
4. Einzelne Kapitel bei Bedarf neu generieren lassen, bevor ich sie freigebe
5. Das fertige Ergebnis am Ende **wahlweise nach Google Drive UND/ODER iCloud** exportieren, in einem konfigurierbaren Zielordner
6. Optional einen **finalen KI-Gegencheck** durch einen zur Laufzeit wählbaren AI-Anbieter (Claude / GitHub Copilot / Gemini) durchführen lassen — als reines Feedback-Gutachten, das NICHT automatisch Änderungen einspielt, sondern konkrete, kapitelbezogene Verbesserungshinweise liefert

Das Funktionsprinzip (Kapitel splitten → pro Kapitel ein Regelwerk-gesteuerter LLM-Call → Review pro Kapitel → Export) habe ich bereits als browserbasierten Prototyp gebaut (siehe `reference/revision_agent_prototype.html`, liegt bei — falls du eine visuelle/funktionale Referenz brauchst, sieh dort nach, bevor du das UX-Konzept neu erfindest). Portiere die Idee sauber ins bestehende Admin-Panel, kopiere aber keinen Code 1:1, sondern baue es dem Stack entsprechend.

---

## 1. Datenmodell

Lege (im vorhandenen Storage-System — DB falls vorhanden, sonst schlage eine leichte Lösung wie SQLite/Postgres vor, falls bisher nur Static Files existieren) folgende Entitäten an:

- **`novels`**: id, title, author, created_at, aktives Regelwerk (Referenz)
- **`style_rulesets`**: id, novel_id (oder global wiederverwendbar über mehrere Romane), name, dateien (Constitution-Text, ggf. mehrere Zusatzdokumente wie meine "Leserlichkeits-Guideline"), Versionierung
- **`manuscript_versions`**: id, novel_id, upload_datum, Originaldatei-Referenz, Quelle (Upload)
- **`sections`**: id, manuscript_version_id, order_index, heading, original_text, revised_text, status (`pending`/`processing`/`done`/`error`/`approved`), changes (Liste), words_before, words_after, letzte Bearbeitung
- **`revision_runs`**: id, manuscript_version_id, gestartet_von, gestartet_am, Status (laufend/pausiert/fertig), verwendetes Regelwerk (Snapshot, nicht nur Referenz — falls sich das Regelwerk später ändert, soll der Lauf reproduzierbar bleiben)
- **`review_reports`**: id, manuscript_version_id, ai_provider (claude/copilot/gemini), erstellt_am, Gesamtbewertung, kapitelbezogene Kommentare (strukturiert: Kapitel → Liste von Beobachtungen mit Kategorie z. B. Pacing/Theologie/Stimme/Prosa)
- **`export_jobs`**: id, manuscript_version_id, Ziel (`google_drive`/`icloud`), Zielordner-Pfad, Status, Zeitstempel, resultierende Datei-URL/-Pfad

## 2. Kapitel-Splitting

- Manuskript-Upload akzeptiert docx/pdf/txt (nutze vorhandene Parsing-Libraries des Stacks; für docx z. B. mammoth, für pdf z. B. pdf-parse/pdfplumber-Äquivalent im jeweiligen Ökosystem)
- Automatische Erkennung von Kapitelgrenzen über Heading-Muster (Kapitel/Chapter/Prologue/Interlude/Teil/Part — mehrsprachig, da ich sowohl englische als auch deutsche Manuskripte habe)
- Nach automatischer Erkennung: **manuelle Korrekturmöglichkeit** im UI (Grenzen verschieben, Abschnitte zusammenführen/teilen), bevor der Lauf gestartet wird — automatische Erkennung wird nicht immer perfekt sein
- Jeder erkannte Abschnitt wird als `sections`-Zeile gespeichert

## 3. Regelwerk-Verwaltung

- Eigener Unterbereich, in dem ich pro Projekt/Roman ein oder mehrere Regeldokumente hochladen/pflegen kann (Freitext/Markdown-Editor im Admin reicht)
- Diese Dokumente werden **nicht** hart im Code verdrahtet, sondern zur Laufzeit in den System-Prompt der Revision eingebettet — ich muss Regeln ändern können, ohne dass du erneut Code anfassen musst
- Unterstütze das Konzept "mehrere Regeldokumente gleichzeitig aktiv" (z. B. Haupt-Constitution + separate Ergänzungs-Guideline), da ich das bei mehreren Projekten so handhabe
- Pro Kapitel-Typ (Prolog/Kapitel/Interlude/Dream Fragment o. ä.) soll optional ein abweichender Straffungs-Zielkorridor (Prozentwert) hinterlegbar sein — analog zu einer Tabelle wie in meiner Constitution (siehe Referenzprototyp für das Konzept)

## 4. Revisions-Lauf (Kernstück)

- Start eines Laufs pro Manuskriptversion
- Sequenzielle Verarbeitung Kapitel für Kapitel (nicht alle parallel — Kosten- und Rate-Limit-Kontrolle), mit:
  - Live-Fortschrittsanzeige (x / y Kapitel, aktuelle Wortzahl-Reduktion)
  - Pause/Fortsetzen-Funktion
  - Bei Fehlern (API-Fehler, Rate Limit): Abschnitt als `error` markieren, Lauf läuft mit nächstem Abschnitt weiter, nicht komplett abbrechen
- Pro Kapitel: LLM-Call (Claude API, Modell konfigurierbar) mit System-Prompt = aktives Regelwerk + kapitelspezifischer Zielkorridor + Ausgabeformat-Vorgabe (strukturiertes JSON: überarbeiteter Text + Änderungsliste + Wortzahl)
- Ergebnis-UI pro Kapitel: Original/Überarbeitet nebeneinander, Änderungsliste, Buttons "Übernehmen" / "Neu generieren" / "Original behalten"
- **Nichts wird ungefragt final gemacht** — ich muss pro Kapitel (oder gesamt) explizit freigeben, bevor der Export erfolgt
- API-Keys (Anthropic etc.) über bestehenden Secrets-Mechanismus des Deployments (nie im Client-Code, nie im Repo committen)

## 5. Cloud-Export (Google Drive UND iCloud, beides wählbar)

**Google Drive:**
- Google Drive API (OAuth 2.0, `drive.file`-Scope reicht, kein voller Drive-Zugriff nötig)
- Ich autorisiere einmalig über OAuth-Flow im Admin-Panel, Token wird sicher gespeichert (verschlüsselt, serverseitig, nicht im Klartext)
- Export erzeugt eine Datei (docx bevorzugt, alternativ txt/md) im von mir gewählten/konfigurierten Zielordner

**iCloud — wichtiger technischer Hinweis, bevor du das baust:**
Es gibt **keine offizielle, allgemein nutzbare iCloud-Drive-API für Web-Apps** wie bei Google Drive (Apples CloudKit JS ist für eigene registrierte Apps mit Apple-Developer-Container gedacht, nicht für beliebigen Drittanbieter-Zugriff auf den persönlichen iCloud-Drive-Ordner eines Nutzers). Baue daher **keine** komplexe CloudKit-Integration, sondern die pragmatische, zuverlässige Variante:
- Export-Button erzeugt die fertige Datei als Download (Browser-Download bzw. File System Access API, falls Browser-Unterstützung vorhanden)
- Ich wähle beim Download lokal meinen iCloud-Drive-Ordner (z. B. `~/Library/Mobile Documents/com~apple~CloudDocs/...`) als Zielort — die Synchronisation übernimmt dann macOS/iOS automatisch, wie bei jeder anderen Datei auch
- Kennzeichne diesen Weg im UI klar als "Als Datei herunterladen (für iCloud Drive: in deinen iCloud-Drive-Ordner speichern)", damit die Erwartung korrekt ist
- Falls sich herausstellt, dass es für den konkreten Anwendungsfall doch eine bessere Lösung gibt (z. B. über eine bereits vorhandene Automatisierung), sag mir das, bevor du weiterbaust

Beide Export-Wege sollen im UI parallel als Optionen erscheinen (Checkbox/Auswahl: Google Drive, iCloud-Download, oder beides), nicht exklusiv.

## 6. Finaler KI-Gegencheck (Anbieter zur Laufzeit wählbar)

- Nach Abschluss (oder auch unabhängig von) der Revision: Button "Finales Gegenlesen"
- UI-Auswahl: **Claude / GitHub Copilot / Gemini** — zur Laufzeit wählbar, nicht fest verdrahtet
- Baue dafür eine **provider-agnostische Abstraktionsschicht** (ein Interface `reviewProvider.review(manuscriptText, ruleset) → StructuredReport`), mit einer Implementierung pro Anbieter. Jeder Anbieter braucht seinen eigenen API-Key/Auth-Mechanismus (Copilot ggf. nur wenn eine geeignete API verfügbar ist — recherchiere den aktuellen Stand der jeweiligen API-Verfügbarkeit, bevor du das für Copilot fest einplanst, das könnte Einschränkungen haben)
- Der Gegencheck **ändert den Text nicht automatisch**. Ergebnis ist ein strukturiertes Gutachten:
  - Gesamteinschätzung (kurz)
  - Pro Kapitel: konkrete Beobachtungen, kategorisiert (z. B. Pacing, Figurenstimme, Metaphern-Dichte, theologische Konsistenz, Wiederholungen), mit klarer Formulierung, WAS verbessert werden könnte und WARUM
  - Keine pauschalen Lob-Floskeln — explizit nach "Verbesserungsbedürftig"-Stellen fragen, nicht nur nach Stärken
- Bericht wird gespeichert (`review_reports`) und ist als Markdown/PDF exportierbar, zusätzlich zum eigentlichen Manuskript-Export

## 7. Nicht verhandelbar / Leitplanken für die Implementierung

- Keine automatische Veröffentlichung oder Überschreibung von Originaldateien ohne explizite Freigabe durch mich
- Jeder Schritt (Revision, Export, Gegencheck) muss nachvollziehbar/versioniert sein — ich will jederzeit zur vorherigen Fassung zurück können
- API-Kosten unter Kontrolle halten: sequenzielle statt massenparallele Verarbeitung, sichtbare Fortschrittsanzeige, Pause-Funktion, kein versehentliches Mehrfach-Abfeuern bei Seiten-Reload (Idempotenz pro Kapitel-Status)
- Bestehende Admin-Auth muss diesen neuen Bereich genauso schützen wie die übrigen Admin-Routen

## 8. Vorgehen (Phasen — bitte nacheinander, mit kurzer Rückmeldung nach jeder Phase)

1. Repo-Analyse + Architekturvorschlag (siehe oben) — **erst hier auf mein OK warten**
2. Datenmodell + Backend-Grundgerüst (Upload, Splitting, Regelwerk-Verwaltung)
3. Revisions-Lauf-Engine + UI (Kernfeature)
4. Google-Drive-Export
5. iCloud-Download-Export
6. Finaler Gegencheck mit Provider-Auswahl
7. Kurzer End-to-End-Test mit einem echten (kleinen) Testmanuskript, Ergebnis zeigen

Frag nach jeder Phase kurz nach, bevor du zur nächsten übergehst, statt alles in einem Rutsch durchzuziehen.
