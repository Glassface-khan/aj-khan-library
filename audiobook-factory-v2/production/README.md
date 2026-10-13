# AJK Audiobook Factory 2.0 – lokales, kostenloses Hörproben-Labor

Stand: 13.10.2026. Nur Code und synthetische Offline-Tests sind abgeschlossen.
Es wurden noch keine echten Stimmen, Bücher oder Hörproben verarbeitet.
Die veröffentlichte Cloudflare-Factory bleibt mit PILOT_LOCKED=true gesperrt.

## Architektur für den ersten Test

- Ein privater Rechner erzeugt Hörproben mit Kyutai Pocket TTS auf der CPU.
- Das Tool production/local_pocket_samples.py extrahiert aus einer privaten DOCX-Datei ca. 160 Wörter pro Passage: Anfang, Mitte und Ende.
- Ohne die Option --render werden weder Modell noch Stimme geladen. Es werden nur Wortzahlen ausgegeben. Echte Passage-Texte erscheinen nicht im Protokoll.
- Mit --render entstehen drei WAV-Dateien und ein private_manifest.json. Der Ausgabeordner liegt zwingend AUSSERHALB des öffentlichen GitHub-Repositories.
- Modellgewichte und die öffentliche CC0-Stimmprobe lädt die Pocket-TTS-Bibliothek ggf. beim ersten Start online; private Manuskripte bleiben lokal.
- Kein automatischer Cloudflare-Upload, keine Freigabe zur Gesamtproduktion, kein geheimer Token und kein kostenpflichtiger TTS-Webservice.
- Pocket TTS unterstützt Englisch und Deutsch; Kokoro/Audiblez bleibt eine spätere Vergleichsoption.

## Lizenzkonzept

**Maggie ist NICHT automatisch für kommerzielle Veröffentlichungen freigegeben.**
Die frühere Stimme verwendete die Referenzdatei ex04_narration_longform_00001.wav von Kyutai/Expresso. Kyutai ordnet ihr eine CC-NC-Lizenz zu.
Quelle: https://huggingface.co/kyutai/tts-voices

Kyutai erklärt die übrigen eigenen Aufnahmen des Verzeichnisses unmute-prod-website für CC0, darunter default_voice.wav.
Die automatisch verfügbare und dokumentierte Vergleichsstimme lautet darum kyutai-cc0-default.
Für eine andere lokal vorliegende WAV-Stimmreferenz muss der Eigentümer --confirm-voice-rights angeben.
Dies ersetzt keine Prüfung sämtlicher Modell-/Verwertungsrechte vor kommerziellem Release.

Pocket-TTS-API-Dokumentation:
https://github.com/kyutai-labs/pocket-tts/blob/main/docs/API%20Reference/python-api.md

## Beispiel nur für späteren privaten Windows-PC

Voraussetzungen: Python 3.11 oder 3.12, lokale virtuelle Python-Umgebung und Pocket TTS nach offizieller CPU-Installationsanweisung.
Wir haben dies beim Autor noch NICHT installiert. Keine Dateien auf Firmenrechnern oder in GitHub hochladen.

1. Vorher mit einem privaten DOCX-Testtext: python local_pocket_samples.py --docx "C:\PrivateBooks\test.docx" --language EN
2. Anschließend erst nach Bestätigung der privaten Testumgebung:
python local_pocket_samples.py --docx "C:\PrivateBooks\test.docx" --language EN --render --voice-preset kyutai-cc0-default --output "C:\PrivateAudiobooks\sample-1"

Alternative lokale WAV-Referenz nur mit überprüften Rechten:
--voice-wav "C:\PrivateVoices\authorized.wav" --confirm-voice-rights

## Nicht fertig und bewusst gesperrt

- Echtes lokales TTS-Modell noch nicht installiert oder als Live-Audio getestet.
- Finale automatisierte Hörproben-QC und manuelle Autorenfreigabe noch nicht integriert.
- Vollständige M4B-Produktion, Wiederaufnahme und privater Cloudflare-Upload noch ausstehend.
- D1-Tabellenmigration, Admin-End-to-end-Authentifizierung und Pilotfreigabe noch nicht abgeschlossen.
- Die bisherigen Supabase-Audios bleiben unverändert; keine Löschung oder Migration.

## Kostenprinzip

Pocket TTS berechnet keine Gebühr pro Hörminute. Für den lokalen Rechner, Strom, Speicher und ggf. spätere gemietete Rechenleistung können Kosten entstehen. Keine kostenpflichtigen Angebote ohne vorherige Zustimmung.
