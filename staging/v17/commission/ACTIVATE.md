# Inbetriebnahme auf dem vorhandenen Oracle-Host

In ShellFish das mitgelieferte AJK_M4B_Lamp_Keeper.sh ins Home von ajk-tts-ci übertragen und ausführen:
`bash ~/AJK_M4B_Lamp_Keeper.sh`. Kein GitHub-Zugang und kein sudo für den Eigentümerlauf erforderlich.
Der Ablauf sucht genau den laufenden V17-Prozess und übernimmt dessen private Drive-Konfiguration.
Er patcht eine isolierte Modulkopie, nutzt das bestehende Transferbudget und prüft die fünf in pilot-edition.json dokumentierten Teile von The Lamp Keeper.
Er speichert im Pilotregister Metadaten und Belege; die Audiodateien bleiben auf Drive.
Bei vollem Register, erschöpftem Budget, fremdem Port, öffentlichem Funnel oder abweichenden Pfaden bricht er ab.
Der bisherige Serve-Eintrag :10001 bleibt in Betrieb. Die neue private Tailscale-Route :10003 zeigt
ausschließlich auf den isolierten Eigentümer-Hörtest. RUNNING_V17_DRIVE_SEARCH_HTTP meldet die Antwort des laufenden Dienstes; V17_OAUTH_AND_PRIVATE_FILES_OK bestätigt die fünf Einzeldateien mit dessen Drive-Konfiguration. V17_OAUTH_INVALID_GRANT bedeutet, dass die bestehende Oracle-OAuth-App neu autorisiert werden muss. V17_FILE_METADATA_HTTP_403/404 nach erfolgreicher Token-Erneuerung bezeichnet fehlenden Zugriff auf einen Belegpfad; keine öffentlichen Freigaben anlegen. Bei Erfolg lautet die letzte Eigentümermeldung OWNER READY mit URL.
Auf dem iPhone Tailscale verbinden, Safari öffnen, in The Lamp Keeper über die erste Teilgrenze hören,
Safari schließen und die Fortsetzung prüfen.
Dies prüft V17 mit echten Drive-Dateien; den Test im integrierten alten Webplayer über den isolierten
Autorenseiten-Einstieg unten gesondert abschließen.

## Nur bei bereits vorhandenem kostenfreiem Gäste-HTTPS-Zugang

Ein vorhandener TLS-Reverse-Proxy mit Verbindung zum Loopback des Hosts und ein beschreibbarer,
separater Pilot-Webpfad auf dem **bereits authentifizierten Ursprung der Autorenseite** sind Voraussetzungen.
GitHub Pages liefert statische Inhalte aus und führt guest_media.py nicht aus.
Wenn der bestehende Webhost Git-basiert veröffentlicht, PILOT_ASSETS_DIR auf ein NEUES Verzeichnis
im ohnehin verwendeten privaten Checkout setzen und nur diesen Unterordner im vorhandenen kostenfreien
Publikationsweg ausliefern. Keine Änderungen am produktiven index.html vor der Abnahme.

1. Im vorhandenen Nginx-HTTPS-vhost ausschließlich guest-location.nginx einbinden;
   die dort genannte limit_req_zone gehört in den http-Kontext. Nach erfolgreichem
   `nginx -t` den vorhandenen Proxy nach seinem üblichen Verfahren neu laden.
   Keinen Funnel, neuen Host oder neuen kostenpflichtigen Dienst einrichten.
2. Auf dem Host unter `~/ajk-v2-tts/private/legacy-m4b-pilot-d9b78f8/guest.env` (Modus 600)
   die nachstehenden Shell-Variablen mit den tatsächlichen Betriebswerten setzen.
   Die vorhandene Supabase-CLI muss für ipoqyjrojljmbqslmxxf angemeldet sein.
   Vor dem CLI-Deployment inkludiertes Kontingent prüfen. Fehlt eine Voraussetzung, Gäste-Pilot auslassen.
   - COST_FREE_INGRESS_VERIFIED=yes
   - V17_GUEST_ORIGIN=https://<vorhandener-Gäste-Hostname> (ohne abschließenden Slash)
   - V17_GUEST_PORT=18874
   - V17_GUEST_LISTENER und V17_OWNER_LISTENER_ID: vorhandene Hörer-IDs
   Die folgenden drei Pfade sind für The Lamp Keeper bereits vorbelegt. Nur für einen anderen Titel angeben.
   - GUEST_READY_ROW: JSON-Datei aus bestehendem V17-Register mit id,state,document der gewählten Gästeausgabe
   - GUEST_CATALOG_EDITION: passende aktive Ausgabe mit id,title,is_active,status und nach chapter_index geordneten chapters mit id,title
   - GUEST_DRIVE_RECEIPT: bestehender fertiger Backupbeleg derselben Ausgabe mit audio_book_id und files mit name,id,bytes,md5
   - PILOT_ASSETS_DIR: absoluter Pfad zu neuem Pilot-Unterordner auf dem Autorenseiten-Ursprung
3. `bash ~/AJK_M4B_Lamp_Keeper.sh guest` startet nur den Gäste-Pilot. Nach dem 403/206-Durchstich veröffentlicht er
   eine separate Edge Function namens audio-library-m4b-pilot mit eigenen PILOT_V17_-Konfigurationsnamen.
   Funktion und Gateway teilen den lokal erzeugten Schlüssel ohne Ausgabe im Terminal.
   Mit dem zugelassenen Gast den Pilot-Unterordner auf der vorhandenen Autorenseite öffnen, Titel abspielen;
   mit einem Hörer ohne Buchrecht denselben Titel prüfen. Die Testseite nutzt die bestehende Autorenseiten-Anmeldung.

## Rollback und Freigabe

Der Produktionsplayer bleibt auf seiner bisherigen Version, solange die echte Wiedergabe offen ist.
Zum Stoppen des Eigentümerpilots nur den verifizierten Serve-Eintrag :10003 entfernen
(`tailscale --socket=<bestehender privater Socket> serve --https=10003 off`), danach nur den anhand der
owner.pid und /proc/<PID>/cmdline bestätigten Pilotprozess beenden. Für Gäste nur den separaten Proxy-Pfad
deaktivieren, den anhand guest.pid verifizierten Prozess beenden und den Pilot-Unterordner aus der Auslieferung nehmen.
Für den dauerhaften Regelbetrieb benötigt der Pilot die bestehende Prozessüberwachung des Hosts.
Die SQL-Datei backup-candidates.sql ist eine reine Leseabfrage. Keine Löschautomatik aktivieren.
