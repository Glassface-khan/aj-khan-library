# AF3 V17 – Integrationsprüfung (06.11.2026)

Status: GEPRÜFT (read-only), OFFEN (Integration), BLOCKIERT (echter PostgreSQL-Paralleltest).

## Live-Readback
- Supabase-Projekt: ipoqyjrojljmbqslmxxf, Edge Function audio-library v15 ACTIVE.
- Die produktive Funktion besitzt verifyAccess(body, bookTitle).
- Für Titelzugriff gelten fullAudioAccess oder allowed=true; bei Katalogzugriff wird audioAccess nach Titel gefiltert.
- m4bSource und m4bPart sind in der produktiven Edge Function v15 NICHT vorhanden.
- PostgreSQL 17.6: af3_family_book_slots, af3_assign_family_book und af3_remove_family_book existieren noch nicht.
- Es wurde nichts in Produktion verändert.

## Entwicklungsänderungen
- 171a7c2: family-slot-handlers.mjs verwendet verifyAccess(body, book.title) und prüft allowed/fullAudioAccess/audioAccess.
- aa0a2a4: Tests für Titelparameter und verweigerte Berechtigung.
- b858a27/aea2f48: Freigabe von Slots auch nach Archivierung oder Berechtigungsentzug.
- 71b76f7: SQL-Testskript für isolierte DB mit zwei echten Transaktionen.

## Sicherheitsgates vor Pilotbetrieb
1. Die vorhandene Google-Drive-Identität muss zum serverseitig geprüften Familienmitglied passen. Ein bloßes Google-OAuth-Token im Browser beweist noch KEINEN Familienzugriff.
2. Privates Drive-Manifest ausschließlich serverseitig einem autorisierten Buch zuordnen. Keine vom Browser gelieferten fileIds oder sizes als Berechtigungsnachweis akzeptieren.
3. m4bSource/m4bPart müssen vor der Ausgabe von Drive-IDs eine vorhandene Familienzuordnung prüfen.
4. Slotlimit 3/1 muss in einer isolierten PostgreSQL-Instanz unter zwei getrennten Sessions und konkurrierenden Buchzuordnungen erfolgreich getestet werden.
5. Vor produktiver Migration: bestehende Familienbibliothek erfassen, Altzuordnungen klären, Rückfallweg und Kosten prüfen, ausdrückliche Freigabe einholen.
6. Keine neue OAuth-App, keine neuen kostenpflichtigen Ressourcen und keine produktiven Workflows ohne Freigabe.

## Testlage
- Bestehende Node-Mocktests und neue Tests sind im Branch; für die Änderungen 171a7c2/aa0a2a4 liegt hier noch KEIN nachweisbarer Node-Testlauf vor.
- Die produktive Supabase-DB wurde nur lesend geprüft. Ein echter SQL-Paralleltest fand NICHT statt.

## Nächster sicherer Block
- Lokale isolierte PostgreSQL-Instanz oder vorhandene kostenlose Testumgebung nachweisen.
- Migration nur dort ausführen, 3/1 und konkurrierende Transaktionen testen, Ergebnisse mit Logs sichern.
- Danach isolierte Edge-Function-Integration vorbereiten, ohne v15 zu ersetzen.
