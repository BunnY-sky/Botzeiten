# Botzeiten 1.3.2

## Änderungen
- `/zeit hinzufuegen` und `/zeit bearbeiten` verwenden jetzt **Minuten** statt Stunden.
- Mindestintervall: **15 Minuten**.
- Beispiele: `15`, `30`, `60`, `120`, `150` Minuten.
- Die **10-Minuten- und 5-Minuten-Erinnerungen bleiben unverändert**.
- Alte Timer mit `intervalHours` werden automatisch in `intervalMinutes` umgewandelt.
- Einzelner `/zeit reset id:<ID>` bleibt erhalten.
- Spawn-Nachrichten werden weiterhin nach 2 Minuten gelöscht.
- YouTube-/TikTok- und Kanal-Konfiguration aus 1.3.1 bleiben erhalten.

## Beispiele
- 15 = alle 15 Minuten
- 30 = alle 30 Minuten
- 60 = alle 1 Stunde
- 120 = alle 2 Stunden
- 150 = alle 2 Stunden 30 Minuten
