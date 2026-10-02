# aj-khan-library — Autorenseite

Statische GitHub-Pages-Seite (`index.html`) für A. J. Khans Autorenseite.

**Architekturdetails, Datenmodell, Backend-Endpunkte und offene TODOs:
siehe [ARCHITECTURE.md](./ARCHITECTURE.md).**

Kurzfassung: `index.html` ist ein kompilierter Claude-Design-Canvas-Export
(Bundler-Format). Seit 20.08.2026 ist **dieses Repo/Claude Code die Source
of Truth** — nicht mehr Claude Design. Buch-Live-Daten (Klappentext, Cover,
Links, Status) laufen über ein Google-Apps-Script-Backend und syncen ohne
GitHub-Push; ein GitHub-Push ist nur für Struktur-/Layout-Änderungen sowie
als Seed-Snapshot-Backup nötig.

## Verbindlicher Buchabschluss-Trigger

Wenn der Autor **„bitte abschließen“**, **„Buch abschließen“**, **„finalisieren“**
oder sinngemäß eindeutig den Abschluss eines Buches verlangt, ist automatisch
der vollständige Ablauf in [BOOK_CLOSE_WORKFLOW.md](./BOOK_CLOSE_WORKFLOW.md)
auszuführen.

Dabei gilt insbesondere als harte Website-Regel:

- das finale öffentliche Cover liegt unter `assets/covers/`;
- `coverUrl` verwendet einen same-origin GitHub-Pages-Pfad;
- niemals Google-Drive-/Docs-/Thumbnail-URLs als öffentliche Cover-Quelle;
- EPUB, Manuskript, Audits und interne Produktionsdateien bleiben privat;
- ein Buch darf erst als abgeschlossen gemeldet werden, wenn Cover, Katalog,
  Privacy-Checks und Live-Smoketest bestanden sind.

Ein finaler DOCX/EPUB/ZIP-Stand allein ist **kein vollständiger Buchabschluss**.
