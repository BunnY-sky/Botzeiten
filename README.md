# Botzeiten 1.2.0

## Neue Tracker-Funktion

Bosszeiten sind jetzt **Intervall-Tracker** statt fester Uhrzeiten.

Beispiel:
- Oberork: `2 Stunden`
- Maintenance completed um `16:19`
- nächster Oberork: `18:19`
- danach: `20:19`, `22:19`, usw.
- 10 und 5 Minuten vorher kann weiterhin gepingt werden.

Sobald der Bot im konfigurierten Maintenance-Channel die Nachricht

`RIBUT | MAINTENANCE COMPLETED`

erkennt, werden **alle Boss-Tracker gleichzeitig zurückgesetzt**. Das Emoji vor dem Text ist für den Trigger nicht erforderlich.

## Discord-Berechtigungen / Intent

Im Discord Developer Portal muss für den Bot der **Message Content Intent** aktiviert sein.

Der Bot benötigt im Maintenance-Channel mindestens:
- Channel ansehen
- Nachrichtenverlauf lesen

## `.env`

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
- `/config trackerkanal channel:#maintance-tracker`
- `/zeit hinzufuegen name:Oberork stunden:2`
- `/zeit anzeigen`
- `/zeit bearbeiten`
- `/zeit loeschen`
- `/zeit reset`
- `/youtube hinzufuegen`
- `/youtube anzeigen`
- `/youtube entfernen`
- `/youtube test`
- `/status`
- `/help`

## Automatischer Maintenance-Reset

Der bevorzugte Weg ist `/config trackerkanal channel:#maintance-tracker`.

Wenn kein Tracker-Channel konfiguriert ist, sucht der Bot automatisch nach einem Textkanal mit dem Namen `maintance-tracker`.

Eine erkannte Nachricht mit `RIBUT | MAINTENANCE COMPLETED` setzt alle Tracker auf:

`jetzt + jeweiliges Intervall`

## Hinweis

`.env` niemals zu GitHub hochladen.
