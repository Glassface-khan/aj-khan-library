# AJK Factory 2.0 — bevorzugter ONLINE-TTS-Prozess (Stand 13.10.2026)

**Autorenentscheidung:** Keine lokale PC-Pflicht. Hörbücher unterwegs vom iPhone aus anstoßen und später anhören; bevorzugt kostenlos, keine ungefragten Kosten. Vier LALAL.AI-Referenzen: Jessica EN / Jessica DE (erste Wahl), Gandalf EN / Gandalf DE. Maggie nicht mehr aktiv.

## Noch kein Rechendienst freigeschaltet

**Die Live-Factory bleibt `PILOT_LOCKED=true`.** Mit dem neuen Modul `job_contract.py` sind lediglich Datenvertrag und Sperrregeln entworfen. Keinerlei reale Provider-Konten, Zugangsdaten, API-Kosten, Modellgenerierung oder Cloud-Dateitransfers wurden angelegt bzw. ausgeführt.

## Architektur

1. Autor öffnet die private Factory am iPhone mit seiner **bisherigen Admin-Anmeldung**. Familie/Gäste dürfen in Factory 2.0 keine Aufträge erzeugen.
2. Eine freigegebene DOCX-/EPUB-Quelle und die Voice-Referenz werden **privat** in Cloudflare R2 verwahrt. Niemals in öffentlichen GitHub Actions, Commits, Spaces-Demo-Uploads oder ungeschützten URLs.
3. D1 verwaltet Auftrag, Stimme, die drei Sample-Positionen, Status, Checksummen, QC und Budget-/Freigabeentscheidung.
4. Ein separat geschützter Online-Rechenknoten ruft Quelle und Referenz ausschließlich über serverseitig autorisierte kurzlebige Zugriffe ab (noch nicht implementiert), erzeugt drei TTS-Proben, führt lokale QC durch und schreibt sie zurück in privates R2.
5. Autor erhält aus der Factory nur private Player-Links und genehmigt oder verwirft die Stimme. **Keine vollständige Buchproduktion ohne echte Texttreue-/Akustik-QC und ausdrückliche persönliche Freigabe.**
6. Der Cloud-Rechner darf nur für auftragsbezogene Zeit laufen, mit einer einzigen parallelen Produktion und auf das genehmigte Monatsbudget begrenzt. Keine TTS-API mit Gebühren pro Wort oder pro Hörminute.

## Geprüfte realistische Kandidaten

**Modal Starter** – bevorzugt für einen automatisierbaren Pilot, sofern der Eigentümer nach Kostenerläuterung zustimmt. Am 13.10.2026: 30 USD pro Monat inklusive Rechenguthaben für CPU/GPU/Memory, darüber hinaus Pay-as-you-go; kein automatisch garantiertes 0-Euro-Konto. Separate Nutzung (z.B. Shared Endpoints) kann schon früher kostenpflichtig sein. Wir verwenden keine solchen kostenpflichtigen Endpoints. Keine Anmeldung oder Abrechnung initiieren, bevor Risiken/Spending-Limits und Zahlungsmittel geprüft sind. Quelle: https://modal.com/pricing

**Oracle Always Free ARM** – möglicher längerfristiger Null-Euro-Server: Im Always-Free-Kontingent derzeit bis 2 OCPU und 12 GB RAM auf Ampere A1 plus 200 GB Block Volume. Allerdings Registrierung/Kreditkartenprüfung, freie Kapazität nicht garantiert und mögliche Rückgewinnung wenig genutzter Instanzen. Pocket-TTS-Kompatibilität auf ARM und Stabilität noch ungetestet. Quelle: https://docs.oracle.com/de-de/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm

**Hugging Face ZeroGPU** – kostenloses Kurzexperiment für berechtigte Konten (älter als 30 Tage, verifizierte E-Mail) mit maximal 5 GPU-Minuten pro Tag für Free-Nutzer. Nicht für dauerhafte vollautomatische Langbuch-Produktion planen. Private Space erfordert spezielle Auth; öffentliche Demos dürfen keine persönlichen Inhalte oder Stimmreferenzen enthalten. Quelle: https://huggingface.co/docs/hub/main/spaces-zerogpu

**Google Colab Free** – möglicherweise für ein manuell beaufsichtigtes Probe-Audio geeignet, aber kein zuverlässiger Hintergrunddienst bei geschlossenem iPhone.

**GitHub Actions ist ausdrücklich KEIN Dauer-TTS-Rechendienst:** Die offiziellen Nutzungsbedingungen verbieten GitHub-gehostete Runner für andere Aktivitäten als Entwicklung/Test/Deployment/Publikation des zugehörigen Softwareprojekts. Keine Hörbuchproduktion als verdeckte CI-Dauerrechenlast. Quelle: https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features

## Privatsphäre und Lizenz

- Die vier WAV-Referenzen entstanden laut Autor über LALAL.AI. Diese Entstehung dokumentiert den technischen Ursprung, nicht automatisch die Rechte an der ursprünglich benutzten Sprecherstimme. Frühere Gespräche: grundsätzlich kommerzieller Einsatz möglich, **wenn Ausgangsrechte vorliegen**; kein Verkauf ohne überprüfte Nachweise.
- Die Original-Voice-Referenzen bleiben ausschließlich privat. Testen mit Jessica EN; danach Jessica DE und Gandalf EN/DE.
- Technische Sprachkompatibilität steht noch aus. Pocket-TTS ist Open Source und unterstützt Englisch/Deutsch, kann aber die Klangidentität nicht garantiert 1:1 aus einer 14–36-sekündigen WAV übernehmen.
- Keine Rechnung, kein Account-Upgrade, kein kostenpflichtiger Test, kein Speichern von Geheimnissen im Repository ohne ausdrückliche Freigabe.

## Stand / nächste Schritte

Der Plan-Code `online_compute/job_contract.py` nimmt ausschließlich autorisierte Voice-IDs, private R2-Pfade und maximal drei Proben an; er wirft absichtlich `online_tts_dispatch_disabled` statt Jobs auszulösen. Offline-Tests erzwingen diese Sperre.

Offen: Provider-Konto und maximale Kosten sicher konfigurieren, geschützte Cloud-Authentifizierung und Datenschutz, R2/D1-Job-Schnittstelle mit Resumability, Backend Pocket-TTS + echte QC, private Proben im iPhone-Player. D1-Migration noch nicht ausgeführt. Supabase-Altdateien werden nicht angerührt; Backup-Frist 21.10. separat beachten.
