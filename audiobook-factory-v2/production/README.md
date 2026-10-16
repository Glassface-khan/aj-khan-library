# AJK Audiobook Factory 2.0 – privates kostenloses Hörproben-Labor

Stand: 13.10.2026. Nur Entwicklungs- und Offline-Tests sind erfolgreich;
**noch keine reale lokale Pocket-TTS-Hörprobe erstellt**.
Der bereits veröffentlichte Cloudflare-Worker bleibt `PILOT_LOCKED=true` gesperrt.

## Aktive Stimmenentscheidung des Autors

| Stimme | EN | DE | Priorität |
| --- | --- | --- | --- |
| Jessica | `Jessica_EN_Factory_Reference.wav` | `Jessica_DE_Factory_Reference.wav` | **Startstimme** |
| Gandalf | `Gandalf_EN_Factory_Reference.wav` | `Gandalf_DE_Factory_Reference.wav` | Alternative |

Der Autor hat alle vier Stimmreferenzen am 13.10.2026 bereitgestellt.
Die vier überprüften Original-WAVs haben 24 kHz, mono, 16 Bit, sind jeweils
etwa 14–36 Sekunden lang und zeigen bei der Eingangsprüfung kein Clipping.

**Die Referenz-Audios werden aus Datenschutzgründen niemals in dieses
öffentliche GitHub-Repository oder dessen CI-Artefakte hochgeladen.**
Der Autor speichert die Dateien nur in seinem privaten lokalen Stimmordner.

## Erste lokale Testproduktion mit Jessica EN

- Ein privater Rechner erzeugt Hörproben mit Kyutai Pocket TTS auf der CPU.
- `local_pocket_samples.py` extrahiert aus einem privaten DOCX-Manuskript jeweils
  ungefähr 160 Wörter aus Anfang, Mitte und Ende.
- Ohne `--render`: nur Wortzahlen, kein Modellstart, kein Upload.
- Mit `--render`: drei private WAV-Hörproben, ein Manifest mit Stimme und Checksummen,
  und `preliminary_qc.json` für Audioformat, Dauer, Clipping und Stille.
- `preliminary_qc.json` bleibt **HOLD**, bis auch eine lokale Spracherkennung
  (Texttreue) und persönliche Hörfreigabe erfolgreich durchgeführt wurden.
- Keine automatische Veröffentlichung, keine Vollbuchproduktion, keine
  kostenpflichtige TTS-API.
- Ein früherer Kurzsegmentierungsfehler bei Jessica DE zeigt, dass wir
  Segmentlängen und Aussprache real prüfen müssen; Modellqualität ist
  trotz technisch gültiger Referenz nicht garantiert.

Lokales Beispiel (Windows; erst nach privater Installation von Pocket TTS):

```powershell
python local_pocket_samples.py --docx "C:\PrivateBooks\test.docx" --language EN --voice jessica --voice-dir "C:\PrivateVoices"
python local_pocket_samples.py --docx "C:\PrivateBooks\test.docx" --language EN --voice jessica --voice-dir "C:\PrivateVoices" --render --confirm-voice-rights --output "C:\PrivateAudiobooks\jessica-en-test"
```

Für Jessica DE: `--language DE --voice jessica`.
Für Gandalf EN/DE: `--voice gandalf` mit der passenden Sprache.
Die vier WAVs müssen im angegebenen privaten Stimmordner unter genau
den Dateinamen aus der obigen Tabelle liegen. Die Originalaufnahmen
werden nicht überschrieben.

## Rechte und spätere Veröffentlichungen

Der Autor berichtet, dass die Nutzungsrechte bereits in älteren Gesprächen
besprochen wurden. Der nachvollziehbare ältere Prüfstand ist differenzierter:
Die Gandalf-Referenzen wurden mit LALAL.AI geklont. Eine grundsätzliche
kommerzielle Nutzung kann erlaubt sein, wenn die Rechte an der zugrunde
liegenden Stimme vorliegen. Bei Jessica EN/DE liegt uns ein früherer
technischer Produktions-/Freigabestand vor, aber kein dokumentierter
eindeutiger Rechteherkunftsbeleg.

**Für private technische Tests wird nichts öffentlich verwertet.**
Vor Verkauf/kommerzieller Veröffentlichung sind Rechteherkunft,
TTS-Modellbedingungen und Stimmfreigabe dokumentiert zu prüfen.
Der Schalter `--confirm-voice-rights` ist eine lokale Bestätigung,
kein Lizenznachweis.

## Was weiterhin offen ist

- Eigentliche Pocket-TTS-Installation auf einem privaten Rechner und
  Hörprobe mit echten Stimmen.
- Vollständige ASR-Texttreue-Prüfung, manuelle Autoren-Freigabe und
  sichere Wiederaufnahme nach Produktionsfehlern.
- D1-Migration, Admin-Authentifizierung über bestehendes Apps Script,
  Cloudflare Upload/Streaming und spätere M4B-Erstellung.
- Nur synthetische GitHub-Tests; keine privaten Bücher/Stimmen/Transkripte
  in öffentliche GitHub Actions laden.
- Supabase-Bestand unverändert. Kein Löschen ohne verifizierte Sicherung
  und konkrete Einzelfreigabe.

## Erwartete Kosten

Pocket TTS wird lokal ausgeführt und berechnet keine Gebühren pro Hörminute.
Strom und lokaler Rechenaufwand fallen an; zusätzliche Cloud-Speicher-/Compute-
Dienste werden nur nach ausdrücklicher Freigabe eingeschaltet.

## Online-Produktion: portable R2-Anbindung (13.10.2026)

Der Nutzer möchte die Factory vom iPhone aus steuern und keine lokale
Rechenleistung bereitstellen. Deshalb ist `r2_private_transport.py` als
**austauschbare R2-Schnittstelle** hinzugekommen. Sie lädt Manuskripte und
Jessica/Gandalf-WAVs ausschließlich aus dem privaten R2-Bucket und schreibt
neue Hörproben unter eindeutigen Auftragskennungen **ohne Überschreiben**
zurück. Es gibt weder öffentliche URLs noch Löschfunktionen. Die isolierten
Tests benutzen künstliche Daten und keinerlei Kontozugänge.

**Keine echte R2-Übertragung oder Audioerzeugung wurde bisher ausgeführt.**
Die Live-D1-Migration, ein sicherer Start-Endpunkt, R2-S3-Zugangsdaten,
ein online laufender TTS-Rechner und End-to-end-Proben bleiben offen.

### Wichtige Nutzungsrichtlinie und Kostenentscheidung

Der alte TTS-Worker lief auf GitHub Actions mit Pocket TTS und Whisper.
GitHub Free umfasst 2.000 Linux-Runner-Minuten/Monat für private Repositories
und setzt ein Ausführungslimit von sechs Stunden pro Job. ABER GitHubs
zusätzliche Nutzungsbedingungen verbieten es, Actions als allgemeinen
Serverless-Anwendungsdienst zu verwenden oder GitHub-hosted Runner für
Aufgaben ohne Bezug zur Entwicklung/Prüfung/Veröffentlichung der zugehörigen
Software einzusetzen. Der geplante dauerhafte Ablauf
Cloudflare -> repository_dispatch -> GitHub-Actions-Audiobook-Produktionsdienst
wird daher **nicht** eingerichtet; GitHub Actions bleiben für Code-Tests
und Software-CI verfügbar. Private Repositories beheben diesen
Nutzungsrichtlinien-Konflikt nicht.

Quelle: https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features

Aktuelle Alternative zum Testen einer privaten, kontinuierlichen Online-CPU:
Oracle Cloud Always Free mit aktuell 2 OCPUs/12 GB RAM, vorbehaltlich
Verfügbarkeit, Kontoregistrierung und Terms. Eine kommerzielle
Mehrnutzung darf ohne separate Zustimmung nicht aktiviert werden.
Der kostenlose Hugging Face CPU Basic Space verlangt für neu erstellte
Gradio/Docker-Compute-Spaces mittlerweile einen Bezahlplan, auch wenn
das reine CPU-Kontingent als kostenlos ausgewiesen wird.

Quellen:
https://docs.oracle.com/de-de/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
https://huggingface.co/docs/hub/spaces-overview

