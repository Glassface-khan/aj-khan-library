# Audio-Funktion live schalten

Der Website-Teil und Supabase sind bereits vorbereitet. Damit die Audio-Rechte
mit den bestehenden Nutzer-Zugangscodes funktionieren, muss das Live-Google-
Apps-Script einmal aktualisiert werden.

## 1. AudioAccess.gs hinzufügen

Im Apps-Script-Editor:

1. Links auf **+** neben „Dateien“ klicken.
2. **Script** wählen.
3. Datei **AudioAccess** nennen.
4. Den kompletten Inhalt aus
   `reference/apps-script/AudioAccess.gs` einfügen und speichern.

## 2. Code.gs ersetzen

Den kompletten Inhalt von
`reference/apps-script/Code.gs`
in die bestehende Live-Datei `Code.gs` kopieren und speichern.

Der Referenzstand enthält bereits diese Einbindung am Anfang von `handle(e)`:

```js
const audioResponse = handleAudioAccessAction(e);
if (audioResponse) return audioResponse;
```

## 3. New version deployen

**Deploy → Manage deployments → Stift-Symbol → Version: New version → Deploy**

Nur „Speichern“ reicht nicht; die bestehende Live-URL nutzt sonst weiter die
alte Version.

## 4. Danach

Nach dem Deploy kann die Autorenseite dieselben bestehenden Zugangscodes
verwenden und im Audio-Panel pro Nutzer/Roman Audio-Rechte vergeben. Der
Hörfortschritt wird in Supabase gespeichert; die Zugangscodes selbst werden
nicht dort gespeichert.
