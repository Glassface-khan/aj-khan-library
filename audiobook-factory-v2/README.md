# A. J. Khan — AUDIOBOOK FACTORY 2.0 (ADMIN-ONLY)

**Entscheidung vom 12. Oktober 2026:** Die zweite Audiobook Factory ist ein **privates Werkzeug ausschließlich für den Autor/Admin**. Es gibt KEINE Anmeldung für Familienmitglieder, KEINE Gastkonten, KEIN Familien-Zugriffsmanagement und KEINE allgemeine Hörbibliothek in der Factory 2.0. Die bestehende Autorenseite und Familienbibliothek bleiben unverändert.

**Status:** GitHub Draft PR #49, nicht produktiv deployed. Cloudflare-Konto/R2/D1 und TTS/ASR müssen noch eingerichtet werden. Bisher wurden nur isolierte synthetische Code-/Sicherheitstests durchgeführt; keine echten Aufnahmen. Nicht mergen, veröffentlichen oder produktive Daten löschen.

## 1. Oberstes Ziel
Der Autor kann sich mit seiner vorhandenen **Admin-Anmeldung** auf der bisherigen Autorenseite anmelden und die Factory 2.0 als getrennte Werkstatt benutzen:
1. Buch auswählen / DOCX-Manuskript privat hochladen.
2. Sprache und Stimme auswählen (später mit echten, rechtlich nutzbaren TTS-Stimmen).
3. Drei Hörproben aus Anfang, Mitte und Ende automatisch produzieren.
4. Texttreue, Transkript, Aussprache, Sprechtempo, Stille, Clipping und Audioqualität prüfen.
5. Hörproben persönlich anhören, akzeptieren oder ablehnen. **Erst nach ausdrücklicher Zustimmung** vollständiges Hörbuch produzieren.
6. Privates M4B mit Kapitelmarken und optional MP3-ZIPs erstellen; Ergebnis anhören, herunterladen und privat nach Google Drive sichern.
7. Neue Ausgabe mit alter vergleichen. Alte Supabase-Audios nur nach nachgewiesener Ersatzqualität, geprüfter Sicherung und **gesonderter konkreter Löschfreigabe** entfernen.

Die Factory dient **nicht** der Freigabe an die Familie. Ein späterer Transfer einer abgenommenen Audioedition in die bestehende private Familienbibliothek ist ein **separates, ausdrücklich zu genehmigendes Projekt**, nicht Teil dieses Prototyps.

## 2. Bestehender Admin-Zugang bleibt erhalten
- Der neue Worker verwendet ausschließlich den Admin-Token der bisherigen Autorenseite und prüft ihn **serverseitig** bei Google Apps Script über `checkAudioAccess`. Erfolgreich ist die Prüfung nur bei `ok=true`, `isAdmin=true`, `fullAudioAccess=true` und einer gültigen `listenerId`.
- **Normale Familien-/Besucher-Codes werden nicht angenommen**, auch dann nicht, wenn sie bisher AudioAccess für ein Buch haben.
- Es gibt keine Registrierung, Passwort-Neuanlage, Google Drive Familienfreigabe oder Supabase Auth für Factory 2.0.
- Die Test-Weboberfläche prüft zusätzlich den vorhandenen Browser-Admin-Status. Dies ist nur Komfort; das Backend blockiert unabhängig davon sämtliche nicht autorisierten Anfragen.
- Das R2-Bucket bleibt privat. Kurze HMAC-signierte Media-Links sind zeitlich begrenzte Bearer-Links: Wer einen Link kopiert, kann ihn bis zu seinem Ablauf verwenden. Dies ist **kein DRM**; der finale Einsatz benötigt Rate-Limits, Link-Renewal, Auth-Härtung und reale iPhone-Tests.
- Admin-Token nicht im Chat, in GitHub, in Screenshots, URL-Query-Parametern oder in Logausgaben speichern. Die Serverprüfung verwendet POST-Body, nicht öffentliche GET-Query.
- Das GitHub-Repository ist öffentlich; **keine echten Manuskripte, Stimmen, Audios, Tokens oder private Download-URLs hineinladen**.

## 3. Geplante Architektur
- **GitHub Pages**: bisherige Autorenseite unverändert; eine neue Admin-only Werkstatt-Oberfläche ist als Source-Entwurf vorhanden, jedoch nicht live.
- **Google Apps Script**: bestehende Admin-Identität und serverseitige Prüfung (unabhängig von Supabase).
- **Cloudflare Worker**: alle Endpunkte zur Auftragsanlage, Kataloganzeige, signierten Hörfreigabe und privatem R2-Streaming nur nach verifizierter Admin-Anmeldung. Ausnahme `GET /health`: technischer minimaler Status ohne private Daten. Keine weiteren Familien-Endpunkte.
- **Cloudflare D1**: Datensätze über Hörbucheditionen, Kapitel, persönliche Admin-Hörposition, Jobs, QC und Publikations-/Entscheidungsprotokoll.
- **Cloudflare R2, privat**: DOCX-Quellen, künftig Hörproben und fertige MP3/M4B.
- **GitHub Actions / abgesicherte Produktionsumgebung**: künftige Sprachsynthese und Qualitätsprüfung. Noch nicht angeschlossen; keine Audio-Artefakte in öffentlichen GitHub Actions.
- **Google Drive**: private Kopien nach finaler Verifizierung; die Altbestands-Sicherung bis 21.10. läuft separat.
- **KEIN Supabase in Factory 2.0**. Das alte Supabase-Projekt bleibt bis zur Datenrettung unverändert.

## 4. Tatsächlich implementierter Code
| Datei | Funktion und Stand |
| --- | --- |
| `src/worker.mjs` | Admin-only Worker: `POST /v1/catalog`, `POST /v1/chapter-ticket`, `GET/HEAD /v1/media/:id`, `POST /v1/jobs`, `POST /v1/jobs/list`, `PUT /v1/jobs/:id/source`, `GET /health`. Letzter Endpunkt ohne private Inhalte. Noch nicht deployed |
| `src/security.mjs` | HMAC-signierte kurzlebige Audiotickets und Signatur-/Ablauf-Prüfungen |
| `pilot.html` | Vereinfachte nur-Admin-Testoberfläche (Cloudflare-Ziel noch absichtlich nicht konfiguriert; kein produktiver Upload) |
| `migrations/0001_initialize.sql` | D1: books, chapters, listening_progress, production_jobs, voice_samples, publication_log |
| `qc/three_sample_gate.py` | Offline-QC: Anfang/Mitte/Ende, Transkriptabgleich, Dauer, Tempo, Clipping und Stille. PASS allein startet **keine** Produktion; persönliche Hörfreigabe ist zusätzlich erforderlich |
| `test/worker.test.mjs` | Tests mit künstlichen Daten, darunter ausdrückliche Ablehnung von gültigen Familiencodes |
| `test/test_qc.py` | Python-QC-Tests |
| `wrangler.example.jsonc` | Muster für späteres Cloudflare-Setup ohne Geheimnisse |
| `.github/workflows/audiobook-factory-v2-test.yml` | Isolierter CI-Test |

## 5. Noch offen / keine falschen Fertig-Aussagen
- Kein echtes Cloudflare-Deployment, keine kostenpflichtigen Ressourcen eingerichtet; ein Konto kann persönliche Registrierung oder Zahlungsdaten benötigen.
- Keine TTS-/ASR-Stimmen angebunden und keine echte Hörprobe produziert. Stimmenwünsche: Maggie als Referenz besonders bevorzugt, Tommy gut, Peter solide, ältere männliche Stimme/Deutsch wünschenswert. Verfügbarkeit/Lizenzen müssen geprüft werden.
- Nicht implementiert: autorseitige Sample-Approve/Reject-API, vollständige Audio-Produktion, Kapitel-Markierung/Final-M4B, Status/Retry und ein tatsächlich laufender Google-Drive-Backup-Worker für V2.
- Nicht implementiert: Wiedergabepositions-API, Langzeit-Ticket-Erneuerung und reale iPhone-/Windows-Testkampagne.
- Vor Produktivbetrieb: sicheres privates Admin-Deployment, serverseitige Auth-Ratenbegrenzung, OIDC/Token-Vorgehen, getrennte Cloudflare-Ressourcen, Kosten-/Quota-Grenzen, DSGVO-/Privatsphäre-Prüfung und Verifizierung der Backup-Wiederherstellung.
- Das R2-System **ersetzt oder entsperrt nicht** die bisherigen 57 fertigen Supabase-Hörbücher; Datenrettung ist ein separates Arbeitspaket.

## 6. Vor jedem kostenrelevanten Schritt
Vor Cloudflare-Konfiguration zeigt die Assistenz eine kompakte Kosten-/Quota-Prüfung (Speicher, monatlicher Traffic, API-Aktionen und Nutzerwachstum). Kontoeröffnung, Zahlungsmittel und persönliche Genehmigungen erfolgen beim Eigentümer. Keine Secret-Kopierorgien und keine unkontrollierte automatische Veröffentlichung.

Cloudflare-Dokumentation:
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/workers/platform/pricing/

## 7. Alt-Audio-Vergleich, 21. Oktober und Löschschutz
- 21. Oktober ist ein Sicherungs- und Prüfzeitpunkt, **kein automatischer Löschtermin**.
- Fehlerhafte oder qualitativ verdächtige Audiobooks werden zunächst als **HOLD** gekennzeichnet. Eine geprüfte neue Version reicht allein nicht: originaler Bestand und neue Edition müssen privat wiederherstellbar gesichert sein.
- Exakte alte Audio-ID, Kapitel-Pfade, Qualitätsbefund, neue Voice-Version, SHA-256, vollständiger Hörtest und Backup-Nachweis bilden die Grundlage einer vorab einzeln zu genehmigenden Löschliste.
- Ohne ausdrückliche Zustimmung zu diesem konkreten Manifest: KEINE Löschung.
- Vollständige Regeln: `SAFE_REPLACEMENT_POLICY.md`.

## 8. Neues Chat-/Entwickler-Handoff
Repository `Glassface-khan/aj-khan-library`, Branch `feature/audiobook-factory-2-independent`, Draft PR: https://github.com/Glassface-khan/aj-khan-library/pull/49

Bestehende Autorenseite: https://glassface-khan.github.io/aj-khan-library/
Bestehende Produktions-Factory: https://glassface-khan.github.io/aj-khan-library/audiobook-factory.html

> Bitte Factory 2.0 aus PR #49 als reine Admin-Werkstatt weiterentwickeln. Keine Familienlogins in V2, nur bestehende Autor-Admin-Anmeldung. Kein Supabase für neue Funktionen. Keine echte Hörbuchproduktion oder Veröffentlichung ohne manuelle Freigabe der drei Proben; keine Löschung alter Dateien ohne geprüftes Backup und genaue neue Zustimmung. V2 ist noch nicht live.
