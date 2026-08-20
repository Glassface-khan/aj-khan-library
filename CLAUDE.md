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
