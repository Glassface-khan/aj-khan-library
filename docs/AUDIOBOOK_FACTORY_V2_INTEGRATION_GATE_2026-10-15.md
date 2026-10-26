# Audiobook Factory 2.0 — Integrations- und Freigabeplan (15.10.2026)

## Verbindliche Entscheidung

**Die bestehende `audiobook-factory.html` bleibt unsere Benutzeroberfläche.**
Die neue, separat entwickelte Google-Apps-Script-Oberfläche in `aj-khan-books` PR #10 ist **keine** Ersatzwebsite. Sie dient höchstens als Referenz für die neue Daten- und Oracle-Verarbeitung.
Kein produktiver Austausch von `index.html`, `audiobook-factory.html`, `apps-script/Code.gs` oder dem bestehenden Supabase-Backend, solange keine vollständigen Migrationstests grün sind.

## Bereits geprüft

- `aj-khan-library` PR #50: alter Factory-Bildschirm + optionale Hörprüfungsnotizen, zwei CI-Checks grün.
- `aj-khan-books` PR #10: neuer privater Drive/Oracle-Worker + vorbereiteter Google-Apps-Script-Control-Plane, Offline-CI grün.
- Frühere `ajk-tts-voices.yml` Smoke-Stage: vier private Stimmen wurden auf Oracle erzeugt; Audio verbleibt auf Oracle.
- **Keiner** dieser Erfolge weist einen funktionierenden End-to-End-Upload von der Live-Website nach.

## Nächste technische Schritte, in genau dieser Reihenfolge

1. Vorhandene Workflow-Secrets und Google-Drive-OAuth prüfen, **ohne Tokens offenzulegen**. Bestehender Read-only-Test: `aj-khan-library/.github/workflows/audiobook-drive-oauth-preflight.yml`. Workflow auf GitHub manuell starten, wenn die Berechtigung erteilt wird. Ein grüner Drive-OAuth-Test der *alten* Anwendung ist nicht automatisch ein Zugriffstest der *neuen* Apps-Script-Quelle.
2. Zugriffspfad für private Manuskripte entwerfen: Oracle muss mit minimalen Rechten genau die neu hochgeladenen Quellen lesen können. `drive.file` gewährt nicht automatisch Zugriff auf Dateien, die eine andere OAuth-App (Apps Script) erstellt hat. Bei 403/404 **stoppen, keinesfalls globales Drive-Sharing oder Public-Link-Freigabe setzen**.
3. Sicheren Queue-/API-Adapter der **bestehenden** Factory für den Oracle-Worker fertigstellen. Er muss pro Buch zwei unabhängige `editionId`-Werte für `jessica_en` und `gandalf_en` erzeugen, Wiederholungen idempotent behandeln und den Status pro Sprecher getrennt schreiben. Testkapitel muss vor Vollproduktion freigegeben werden.
4. Hör-Feedback serverseitig und zugriffsgeschützt speichern und als revisionsfähige Rückmeldung anbieten. Die aktuelle lokale Notizfunktion ist ein Übergang, **keine** browserübergreifende Synchronisation. Kein automatisches Posten in ChatGPT vortäuschen.
5. Fertige WAVs nach echtem Hörtest zu kapitelmarkiertem M4B konvertieren. Wiedergabe vom iPhone und Download mit privat autorisierten Links testen.
6. Löschung: Edition plus Google-Drive-Dateien **und** die zugehörigen lokalen Oracle-Audio-Dateien erst nach Bestätigung bereinigen; Rohmanuskript und zweite Sprecherversion dürfen niemals unbeabsichtigt betroffen sein.
7. End-to-End-Smoketest: synthetisches Kapitel → beide Stimmen → geschütztes Hören → Feedback → Neuauflage → eine Edition löschen → andere Version bleibt intakt. Vorher **kein Merge/Deployment** auf die Live-Seite.

## Nicht erlaubt

- Keine Audioartefakte, Voice-Referenzen, Manuskripte oder Geheimnisse in GitHub committen/hochladen.
- Keine ungeschützte Google-Apps-Script-Web-App und keine öffentliche Oracle-Portöffnung.
- Keine automatische Veröffentlichung ungeprüfter Sprecherfassungen.
- Keine Zusage, dass komplette Audiobooks oder Google-Drive-Löschung bereits funktionieren.
- Keine Verschiebung oder Löschung der alten Supabase-Hörbücher ohne vollständige Migration und Verifikation.

## Benutzeraufwand

So wenig wie möglich. Eine einmalige Google-/GitHub-Autorisierung kann nötig sein, da ChatGPTs GitHub-Verbindung **keinen Workflow-Dispatch** und keine Einsicht in GitHub Secrets bietet. Danach kann die Arbeit an Code und Tests fortgesetzt werden. Der Nutzer soll keine Secrets in den Chat kopieren.
