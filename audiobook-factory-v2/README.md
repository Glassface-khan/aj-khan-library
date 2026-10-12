# A. J. Khan — AUDIOBOOK FACTORY 2.0
## Supabase-unabhängiger, privater Pilot / Stand 12. Oktober 2026

**STATUS: Sicherheitsgeprüfter Code-Prototyp in GitHub-Draft-PR #49. WEDER ALS DIENST DEPLOYT NOCH MIT ECHTEN HÖRBÜCHERN GETESTET.**
**NICHT MERGEN, NICHT LIVE SCHALTEN, NICHTS LÖSCHEN.**

### 1. Zweck und verbindliche Nutzerentscheidungen
- Ziel ist eine robuste Hörbuchfabrik für A. J. Khan und ausschließlich berechtigte Familienmitglieder. Keine öffentliche Hörbuchveröffentlichung, kein öffentliches Audio-Repository und keine unerlaubten Zugriffe.
- Der Nutzer soll sich nicht um mehrfaches Kopieren von Secrets, Screenshots oder komplizierte Installationen kümmern müssen. Die Assistenz übernimmt Code, Vorbereitungen, Tests und technische Prüfungen. Kontoeröffnung, Zahlungsmittel und Drittanbieter-Zustimmungen verbleiben beim Nutzer, wenn erforderlich.
- **Bestehendes Familien-Login beibehalten.** Kein zweites Familienkonto. Die Access-Tabelle in Google Apps Script ist die Berechtigungsquelle. Nutzer haben getrennte Buchsichtbarkeit, EPUB-Lesen/Download/Kopieren, Gedichte und pro-Titel-Hörrechte. AudioAccess darf nur innerhalb der VisibleBooks greifen.
- Eigene Audio-Ausgabe pro Buch/Sprache/Sprecher; wer eine neue Sprecherfassung freigibt, darf damit nicht unabsichtlich andere Editionen überschreiben.
- **Drei Hörproben** je Manuskript / Stimme: Beginn, Mitte, Ende. Automatischer Text/ASR-Vergleich + Geschwindigkeit, Stille, Clipping sowie **persönliche Freigabe des Autors** VOR einer Gesamtproduktion. Keine automatisch freigeschaltete neue Stimme ohne diesen Schritt.
- Werkzeuge der aktuellen Webseite beibehalten: Bücher und Reihen, Cover, EPUB/Reader, Lesezeichen, Gedichte, Mehrsprachigkeit DE/EN, Audible/Audio-Kapitel, Hörfortschritt und verlässliche Statusanzeige, kontrollierte Retry-/Fehlerbehandlung, M4B mit Kapitelmarken, MP3-Archiv/ZIP, Downloads, private Google-Drive-Sicherung.
- Bisherige Stimmeindrücke: Maggie besonders bevorzugt, Tommy gut, Peter solide, deutsche männliche Stimme / ältere Männerstimme wünschenswert. Diese Präferenzen sind Qualitätsziele, keine Behauptung, dass die entsprechenden TTS-Lizenzen/Modelle im neuen Projekt bereits bereitstehen.
- Der Eigentümer kann schlechte ältere Hörbücher später durch nachweislich bessere Editionen ersetzen. **Keine pauschale Löschung am 21. Oktober**: exakt identifizierte Datei-IDs, Quelle, Referenzversion, neue Ausgabe, Freigabe, Backup-/Hash-Nachweise, Abspielprobe und separate explizite Löschgenehmigung sind nötig. Verdächtige/fehlerhafte Aufnahmen zunächst QUARANTÄNE/HOLD, nicht entfernen.

### 2. Warum eine parallele Factory?
Altes Supabase-Projekt \`ipoqyjrojljmbqslmxxf\` bleibt während der Rettung bestehen. Aktuelle HTTP-402-Limitierung sperrt Factory und Audio-Streaming, aber Dateien/Metadaten sind nach letzter Inventur noch vorhanden. Die geplante private Supabase→Google-Drive-Migration bis 21. Oktober bleibt davon unabhängig und hat Priorität. Cloudflare-Code kann ohne Supabase für *neue* Produktionen und Streaming vorbereitet werden, aber er erschließt die bestehenden Supabase-Audios nicht ohne separaten Export.

### 3. Geplante technische Architektur
- Vorhandene statische GitHub-Pages-Autorenseite bleibt Haupt-UI und Legacy-Login-Ausgangspunkt.
- **Cloudflare Worker**: Authentifiziert pro Anfrage via serverseitigen POST an den aktuellen Google Apps Script \`checkAudioAccess\`; liest D1-Metadaten; erzeugt signierte, kurze Media-Tickets; streamt aus privatem R2 per R2-Binding mit HTTP Range. Kein Supabase-Client, keine Supabase-JWTs.
- **D1**: Bücher/Editionen, Kapitel, nicht öffentliche R2-Schlüssel, privater Hörerfortschritt (noch NICHT per Endpoint implementiert), Job-Warteschlange, drei QC-Samples und Publikations-Audit.
- **R2 Standard (privat)**: Neue DOCX-Quellen und künftig Audio-Chunks, End-M4B/MP3. Kein öffentlicher \`r2.dev\`-Zugang, keine öffentlichen Buckets/benutzerdefinierten Domains.
- **GitHub Actions / geschützter Worker**: künftig TTS-Produktion, ASR-QC, Job-Retries; noch nicht angeschlossen. Keine Manuskripte/Voice-Samples/Audiodateien in das **öffentliche** GitHub-Repository oder öffentliche GitHub Actions-Artifacts legen.
- **Google Drive**: Nach bestandenen Prüfungen private redundante Audio-Sicherung; vorhandener OAuth-GitHub-Backup-Mechanismus ist vorbereitet, nicht die gesamte Bibliothek gesichert.
- Bestehendes Apps Script bleibt erforderlich (eigenständige Google-Abhängigkeit). **Supabase-Unabhängigkeit** gilt für das neue Audio-Backend und die Audioproduktion, nicht für Login oder allgemeine Autorenwebseite.

### 4. Bereits programmierte Bestandteile
| Pfad | Status |
| --- | --- |
| \`src/worker.mjs\` | Basis-Worker: \`GET /health\`, \`POST /v1/catalog\`, \`POST /v1/chapter-ticket\`, \`GET/HEAD /v1/media/:chapterId\`; Autor-only \`POST /v1/jobs\`, \`POST /v1/jobs/list\`, \`PUT /v1/jobs/:id/source\`. Login nur nach Apps-Script-Validierung; Medienzugriff nur auf veröffentlichtes Buch; Private R2 Binding. **Noch nicht deployt.** |
| \`src/security.mjs\` | SHA-256-HMAC für kurzlebige Hör-Tickets, Signatur-, Ablauf- und UUID-Prüfung |
| \`migrations/0001_initialize.sql\` | D1: books, chapters, listening_progress, production_jobs, voice_samples, publication_log. Nicht ausgeführt |
| \`qc/three_sample_gate.py\` | lokaler text-/ASR- und Audio-Qualitätscheck (drei Segmente), der bei Fehlern stoppt und zwingend Autorenfreigabe vorsieht |
| \`test/worker.test.mjs\` | isolierte Mocktests (keine echten Zugänge, Dateien oder Kosten) |
| \`test/test_qc.py\` | Python-Tests für Transkriptvergleich, Stille und Clipping |
| \`wrangler.example.jsonc\` | Cloudflare Worker/R2/D1 Bindings, mit absichtlich nicht ersetzten Platzhaltern |
| \`.github/workflows/audiobook-factory-v2-test.yml\` | isolierter GitHub-CI-Test, keine Audio-Dateien oder persönlichen Secrets |

### 5. Sicherheits- und Bedienregeln
- Login-Codes, Admin-Tokens, Cloudflare API-Tokens, R2-Schlüssel oder GitHub-Google-Refresh-Tokens niemals in GitHub Source, HTML, Chat oder Screenshots veröffentlichen. Worker secret \`TICKET_SECRET\` ist ein zufälliger, mindestens 32 Byte starker Wert und wird separat gespeichert.
- Auth-Codes werden nur serverseitig über \`POST\` an Google Apps Script geprüft, nicht in Cloudflare D1 gespeichert. D1 speichert ListenerId ohne Code.
- Browser erhält nur kurzlebige Hör-Tickets. Ein weitergeleiteter Ticket-URL kann bis zum Ablauf missbraucht werden; dieses System ist **kein DRM**. Der Produktionsrelease braucht Ticket-Erneuerung für lange Hörsitzungen, Zugriffsdrosselung für Login-/Ticket-Endpunkte, Monitoring, Datenschutzerklärung und strikten Datenschutztest.
- Die aktuelle Worker-Vorlage hat **noch keinen getesteten Cloudflare-Login-Schutz gegen Brute Force**, keinen vollständigen Fortschritt-Endpoint und keine laufende TTS-Produktion. Der Code darf darum nicht als fertige Familienlösung deployed werden.
- Medien-Etag, Content-Range/206, iOS Safari Hintergrund-Wiedergabe, Kapitelsprung, Resume und Download werden vor dem Rollout mit echten Audios geprüft.
- Browser-Cache/Service Worker nicht mit signierten Audiolinks oder geheimen Dokumenten füttern.
- Auf der Factory muss ein klarer „Production HOLD“ sichtbar bleiben, solange ein Test oder eine Autorfreigabe fehlt.

### 6. Konto-/Kosten-Voraussetzungen – BEVOR reale Ressourcen angelegt werden
Vor Cloudflare-Einrichtung:
1. Nutzer genehmigt Anbieter und gegebenenfalls Zahlungsmittel. Keine automatische gebührenpflichtige Kontoerstellung.
2. Kontingente und Kosten erläutern (auch Limits ab Tagesanfang): R2 Standard 10 GB-Monate + 1 Mio Class A + 10 Mio Class B im freien Kontingent; darüber $0.015/GB-Monat, Speicherklasse **Standard** nutzen (Infrequent Access hat Abrufkosten). R2 Egress kostenlos. Cloudflare D1 Free max. 500 MB pro Datenbank / 5 GB pro Konto, tägliche Query-Quotas; Workers Free 100k Requests/Tag und 10ms CPU je Request. Freie D1-Quotas werden seit Sept. 2026 tatsächlich durchgesetzt. **Nicht unendlich kostenlos.**
3. Private R2-Testbucket + separate D1-Testdatenbank anlegen; keine bestehenden produktiven Buckets anfassen. \`wrangler.example.jsonc\` in lokalen/geschützten Workflow kopieren, UUID einsetzen, Geheimnis via Worker-Secret setzen.
4. Ein winziges synthetisches Audio-Objekt als Test; keine echten Manuskripte/Voice-Samples, bis Auth und Sicherheit abgenommen wurden.

Quellen:
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/

### 7. Was die neue Factory NOCH NICHT kann
- Noch keine reale TTS-Produktion, kein verknüpftes Stimmangebot, kein automatisches Generieren der drei Voice-Samples.
- Noch kein ASR-Modell oder Voice-Klon mit bestätigter Rechtslage angebunden.
- D1 \`listening_progress\` wurde vorbereitet, aber noch kein Speichern/Lesen-API-Endpunkt implementiert.
- Aus den Source-DOCX wird aktuell nur eine private Vormerkung angelegt, nicht direkt eine Hörbuchdatei.
- Erst nach echten Cloudflare-Ressourcen, TTS-/ASR-Worker-Integration und iPhone-Tests entsteht die benutzbare Pilot-Factory.
- Die 57 alten auf „ready“ gesetzten Audiobooks werden nicht automatisch nach R2 bewegt.

### 8. Qualitätsvergleich und EVENTUELLE Löschung ab 21. Oktober
Für jedes alte Hörbuch eine Tabelle: Original-\`audio_books.id\`, \`voice_key\`, Produktionszeit, Kapitel-IDs, Quelldateien/Größe/Hash, Qualitätsmängel, neue Edition, drei Probehörprotokolle, End-QC, neuer Audiohash, Wiedergabeprüfung, private Sicherung. Freigabe mit Namen/ID jedes betroffenen Buchs bzw. Storage-Objekts. Nur bei nachweislich identischen/entbehrlichen Altdateien und bestandener Wiederherstellungsprobe eine separate, ausdrücklich genehmigte Löschung. **Keinesfalls allein nach Datum, Sternbewertung oder „sieht verdächtig aus“ löschen.**

### 9. Nächste technische Meilensteine
- M1 (JETZT): Basismodule + CI-Test-Suite im separaten Draft PR ✅
- M2: TTS-Probeproduktion mit einer **kurzen, vom Autor genehmigten** Manuskriptprobe und zwei Stimmen; vertrauliche Daten erst nach sicherer Deployment-Konfiguration. Noch offen.
- M3: Drei Probeabschnitte pro Buch, ASR/Text-QC, menschliches Anhören, Freigabe und private M4B-Ausgabe. Noch offen.
- M4: Familienrechte, Hörfortschritt, Hintergrundaudio, iOS, per-Buch-Entitlements, private Google-Drive-Sicherung. Noch offen.
- M5: Nur nach Zustimmung produktive Umstellung; **alte Factory als Fallback unverändert**.
- M6: Individuelle Alt-Audio-Ersetzungen, optionales Löschen nur nach Einzel-Freigabe.

### 10. Quellenreferenzen und Entwickler-Übergabe
GitHub: \`Glassface-khan/aj-khan-library\`
Feature-Branch: \`feature/audiobook-factory-2-independent\`
Draft PR: https://github.com/Glassface-khan/aj-khan-library/pull/49
Bestehende Autorenseite: https://glassface-khan.github.io/aj-khan-library/
Bestehende Factory: https://glassface-khan.github.io/aj-khan-library/audiobook-factory.html
Backend: Google Apps Script \`apps-script/Code.gs\` und \`Access\`-Sheet (AudioAccess/ListenerId), Supabase bleibt nur für ALTE Hörbibliothek/Backup-Rettung.
Bisherige Google-Drive-Datenrettung/Handoff: Draft PR #47; vorheriger R2-/Supabase-Auth-Entwurf: PR #48 (separat, NICHT die unabhängige V2).

> Für neuen Chat: „Arbeite am unabhängigen Audiobook-Factory-2.0-Entwicklungszweig PR #49 weiter. Nichts produktiv deployen, keine Daten/Secrets veröffentlichen, keine alten Supabase-Audios löschen. Nächstes Ziel: gesicherter privater TTS-Hörproben-Pilot mit drei Samples und ausdrücklicher Autorenfreigabe.“
