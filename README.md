# Botzeiten 1.1.0

## Funktionen
- Bosszeiten mit 10-Minuten- und 5-Minuten-Erinnerung
- Haupt-Ping zur eingestellten Uhrzeit
- Moderator-Rolle kann den Bot vollständig verwalten
- YouTube-Live-Überwachung
- Mehrere YouTube-Kanäle
- `/help`, `/status`, `/zeit`, `/youtube`, `/config`

## `.env`
Erstelle auf dem Server eine `.env` mit:
```env
DISCORD_TOKEN=...
CLIENT_ID=...
GUILD_ID=...
TIMEZONE=Europe/Berlin
YOUTUBE_API_KEY=...
```

## Befehle
- `/config moderator rolle:@Moderator` (nur Administrator)
- `/config kanal channel:#bosszeiten`
- `/zeit hinzufuegen`
- `/zeit anzeigen`
- `/zeit bearbeiten`
- `/zeit loeschen`
- `/youtube hinzufuegen`
- `/youtube anzeigen`
- `/youtube entfernen`
- `/youtube test`
- `/status`
- `/help`

## Wichtig
`.env` niemals zu GitHub hochladen.
