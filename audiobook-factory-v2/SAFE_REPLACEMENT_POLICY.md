# Alte Supabase-Audios: Vergleich, Ersatz und eventuelle Löschung
**Kein Löschauftrag. Vorlage für eine spätere Einzelentscheidung des Autors.**

## Ausdrücklich genehmigte Regeln
- 21. Oktober 2026 = geplanter Datenrettungs-/Bestandsprüfpunkt; **kein Löschdatum**.
- Kein Löschen durch Skripte, KI, Cronjob oder GitHub Action ohne neu erteilte, konkrete Zustimmung des Nutzers nach Sichtung der betreffenden Dateien.
- "Verdächtig" bedeutet **zur Qualitätsprüfung vorgemerkt**, nicht nachweislich kaputt, entbehrlich oder gelöscht.
- Alte MP3s oder Download-M4Bs nicht allein aufgrund einer niedrigen QC-Zahl, vorläufigen Produktionsstatus, doppelter Titel oder vermeintlich verwaister Kapitel entfernen. Bestehende Audio-Editionen können unterschiedlichen Sprechern, Sprachen oder Büchern zugeordnet sein.
- Der Altbestand ist aktuell nicht vollständig gesichert; für **jede** Löschung vorab den Nachweis einer unbeschädigten, privaten und wiederherstellbaren Kopie verlangen.
- Standardmaßnahme: `HOLD / QUARANTÄNE / NICHT VERÖFFENTLICHEN` statt löschen.
- Versionierbare Rückkehrmöglichkeit (bestehender Player/alte Tabelle) bis bestandenem privaten End-to-End-Test.

## Erforderliches Prüfblatt JE betroffener Edition
| Feld | Beispiel / Eintrag |
| --- | --- |
| Buchname, Sprache, Erzähler | vom Alt-Datensatz |
| Alt-ID `audio_books.id` | konkrete UUID |
| Original-Kapitelzahl und Pfade | jede Datei gesondert aufführen |
| Grund zur Prüfung | tatsächlicher Hörbefund, Reproduktionsschritt |
| Quelle des Originaltexts und Referenzrevision | eindeutiger Manuskript-LOCK |
| Neue Edition und Voice-Key | eindeutige neue ID |
| Drei Hörproben A/M/E | Wortübereinstimmung, Clipping, Stille, WPM, Ton/Emotion |
| Autorenentscheidung zur Stimme | `APPROVED` oder `REJECTED` |
| Endgültige Hörprobe auf iPhone | Kapitelreihenfolge, Pause, Resume, Vollständigkeit |
| Backup der neuen Ausgabe | privater Google-Drive-Ordner + wiederherstellbare Version |
| Prüfsummen | SHA-256 pro File, altes und neues Manifest |
| Einzelgenehmigung Löschung | eindeutige Freigabe mit Datum und präzisen Pfaden |
| Rollback-Evidenz | Wiederherstellung erfolgreich getestet |

## Technisch zwingender Lösch-Workflow — noch NICHT implementiert
1. Read-only Inventur aller Storage-Objekte und Metadaten; Zuordnungen und aktive Editionen bestätigen.
2. Autor hört neue Aufnahme selbst und gibt die Stimme und das komplette Buch frei.
3. Neue Edition privat sichern und Prüfsummen/Wiederherstellung beweisen.
4. Ein `delete-proposal.json` mit exakten IDs/Pfaden und Abhängigkeiten vorlegen.
5. **Erst danach** eindeutige ausdrückliche Zustimmung für genau die vorgeschlagenen Objekte einholen.
6. Nur die ausdrücklich genannten Objekte löschen, danach Integrität der verbleibenden alten Daten prüfen.
7. Jede Durchführung protokollieren; bei Abweichung sofort stoppen.

**Kein Automatismus für den 21. Oktober, auch dann nicht, wenn R2 schneller oder klanglich besser ist.**
