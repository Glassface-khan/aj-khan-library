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
