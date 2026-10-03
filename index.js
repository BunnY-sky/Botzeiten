require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const TIMEZONE = process.env.TIMEZONE || "Europe/Berlin";
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || "";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Fehlende .env Werte: DISCORD_TOKEN, CLIENT_ID oder GUILD_ID");
  process.exit(1);
}

const DATA_FILE = path.join(__dirname, "data.json");

const defaultData = {
  channelId: null,
  moderatorRoleId: null,
  maintenanceChannelId: null,
  lastMaintenanceResetAt: null,
  lastMaintenanceResetReason: null,
  lastMaintenanceMessageId: null,
  events: [],
  youtube: []
};

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
      return structuredClone(defaultData);
    }

    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

    const events = Array.isArray(raw.events) ? raw.events.map(e => {
      const event = { ...e };

      // Alte Version: intervalHours -> intervalMinutes
      if (!event.intervalMinutes && event.intervalHours) {
        event.intervalMinutes = Number(event.intervalHours) * 60;
        delete event.intervalHours;
      }

      if (!event.intervalMinutes || Number(event.intervalMinutes) < 1) {
        event.intervalMinutes = 120;
      }

      return event;
    }) : [];

    return {
      ...structuredClone(defaultData),
      ...raw,
      events,
      youtube: Array.isArray(raw.youtube) ? raw.youtube : []
    };
  } catch (err) {
    console.error("Fehler beim Laden von data.json:", err);
    return structuredClone(defaultData);
  }
}

let data = loadData();

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function nowBerlin() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("de-DE", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);

  const get = (type) => parts.find(p => p.type === type)?.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`
  };
}

function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isAdmin(member) {
  return member?.permissions?.has(PermissionFlagsBits.Administrator);
}

function isModerator(member) {
  return Boolean(
    member &&
    data.moderatorRoleId &&
    member.roles?.cache?.has(data.moderatorRoleId)
  );
}

function canManage(member) {
  return isAdmin(member) || isModerator(member);
}

async function deny(i) {
  const msg = "⛔ Du benötigst die konfigurierte **Moderator-Rolle** oder Administrator-Rechte.";
  if (i.replied || i.deferred) return i.followUp({ content: msg, ephemeral: true });
  return i.reply({ content: msg, ephemeral: true });
}

function roleMention(roleId) {
  return roleId ? `<@&${roleId}>` : "";
}

function channelMention(channelId) {
  return channelId ? `<#${channelId}>` : "";
}

function formatInterval(minutes) {
  minutes = Number(minutes);

  if (!Number.isFinite(minutes) || minutes < 1) {
    return "ungültiges Intervall";
  }

  if (minutes < 60) {
    return `alle ${minutes} Minuten`;
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (mins === 0) {
    return `alle ${hours} ${hours === 1 ? "Stunde" : "Stunden"}`;
  }

  return `alle ${hours} Std. ${mins} Min.`;
}

function getIntervalMinutes(event) {
  let minutes = Number(event.intervalMinutes);

  if (!minutes && event.intervalHours) {
    minutes = Number(event.intervalHours) * 60;
    event.intervalMinutes = minutes;
    delete event.intervalHours;
  }

  if (!minutes || minutes < 1) {
    minutes = 120;
    event.intervalMinutes = minutes;
  }

  return minutes;
}

function getNextSpawnDate(event) {
  if (!event.nextSpawnAt) return null;
  const d = new Date(event.nextSpawnAt);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatRemaining(ms) {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours} Std. ${minutes} Min.`;
  return `${minutes} Min.`;
}

function resetAllTrackers(reason = "Maintenance", resetTimestamp = Date.now()) {
  const resetTime = Number(resetTimestamp) || Date.now();

  for (const e of data.events) {
    const intervalMinutes = getIntervalMinutes(e);

    e.nextSpawnAt = new Date(
      resetTime + intervalMinutes * 60 * 1000
    ).toISOString();

    e.lastReminder10 = null;
    e.lastReminder5 = null;
    e.lastTriggered = null;
  }

  data.lastMaintenanceResetAt = new Date(resetTime).toISOString();
  data.lastMaintenanceResetReason = reason;

  saveData();

  console.log(
    `🔄 Alle Boss-Tracker wurden zurückgesetzt: ${reason} – Reset: ${new Date(resetTime).toLocaleString("de-DE")}`
  );
}

async function checkTimes() {
  const now = Date.now();
  let changed = false;

  for (const e of data.events) {
    const intervalMinutes = getIntervalMinutes(e);
    const intervalMs = intervalMinutes * 60 * 1000;

    if (!e.nextSpawnAt) {
      e.nextSpawnAt = new Date(now + intervalMs).toISOString();
      e.lastReminder10 = null;
      e.lastReminder5 = null;
      e.lastTriggered = null;
      changed = true;
      continue;
    }

    let nextSpawn = getNextSpawnDate(e);

    if (!nextSpawn) {
      e.nextSpawnAt = new Date(now + intervalMs).toISOString();
      e.lastReminder10 = null;
      e.lastReminder5 = null;
      e.lastTriggered = null;
      changed = true;
      continue;
    }

    const remaining = nextSpawn.getTime() - now;
    let reminderType = null;

    if (
      e.reminders !== false &&
      remaining <= 10 * 60 * 1000 &&
      remaining > 5 * 60 * 1000 &&
      e.lastReminder10 !== e.nextSpawnAt
    ) {
      reminderType = 10;
      e.lastReminder10 = e.nextSpawnAt;
      changed = true;
    } else if (
      e.reminders !== false &&
      remaining <= 5 * 60 * 1000 &&
      remaining > 0 &&
      e.lastReminder5 !== e.nextSpawnAt
    ) {
      reminderType = 5;
      e.lastReminder5 = e.nextSpawnAt;
      changed = true;
    } else if (
      remaining <= 0 &&
      e.lastTriggered !== e.nextSpawnAt
    ) {
      reminderType = 0;
      e.lastTriggered = e.nextSpawnAt;

      do {
        e.nextSpawnAt = new Date(
          nextSpawn.getTime() + intervalMs
        ).toISOString();
      } while (
        new Date(e.nextSpawnAt).getTime() <= now
      );

      e.lastReminder10 = null;
      e.lastReminder5 = null;
      changed = true;
    }

    if (reminderType === null) continue;

    try {
      const ch = await client.channels.fetch(e.channelId || data.channelId);

      if (!ch || !ch.isTextBased()) continue;

      let content;

      if (reminderType === 10) {
        content = `⏰ **${e.name}** startet in **10 Minuten**! ${roleMention(e.roleId)}`;
      } else if (reminderType === 5) {
        content = `⏰ **${e.name}** startet in **5 Minuten**! ${roleMention(e.roleId)}`;
      } else {
        content = `🔴 **${e.name} ist jetzt!** ${roleMention(e.roleId)}`;
      }

      await ch.send({
        content,
        allowedMentions: {
          roles: e.roleId ? [e.roleId] : []
        }
      });

      console.log(
        `Boss-Tracker ${e.name}: ${
          reminderType === 0
            ? "Spawn"
            : `${reminderType} Min Erinnerung`
        }`
      );
    } catch (err) {
      console.error(`Fehler bei "${e.name}":`, err.message);
    }
  }

  if (changed) saveData();
}

function maintenanceText(message) {
  const parts = [
    message?.content || "",
    ...(message?.embeds || []).flatMap(embed => [
      embed.title || "",
      embed.description || "",
      embed.author?.name || "",
      ...(embed.fields || []).flatMap(f => [f.name || "", f.value || ""])
    ])
  ];

  return parts.join("\n");
}

function isMaintenanceCompletedMessage(message) {
  if (!message) return false;

  const channelMatches = data.maintenanceChannelId
    ? message.channelId === data.maintenanceChannelId
    : message.channel?.name === "maintance-tracker";

  if (!channelMatches) return false;

  // Absichtlich KEIN message.author.bot-Filter:
  // Die RIBUT-Meldung kann von einem Bot oder Webhook kommen.
  const text = maintenanceText(message);

  return /RIBUT\s*\|\s*MAINTENANCE\s+COMPLETED/i.test(text);
}

async function processMaintenanceMessage(message) {
  if (!isMaintenanceCompletedMessage(message)) return false;

  if (data.lastMaintenanceMessageId === message.id) return false;

  console.log(
    `🛠️ Maintenance-Trigger erkannt in #${message.channel?.name}: ${maintenanceText(message).slice(0, 300)}`
  );

  data.lastMaintenanceMessageId = message.id;

  // Der Zeitpunkt der Discord-Nachricht ist der Resetpunkt,
  // nicht der Zeitpunkt, an dem unser Bot sie verarbeitet.
  resetAllTrackers(
    `Maintenance: ${message.id}`,
    message.createdTimestamp
  );

  return true;
}

async function checkMaintenanceHistory() {
  const channel = data.maintenanceChannelId
    ? await client.channels.fetch(data.maintenanceChannelId).catch(() => null)
    : client.channels.cache.find(c => c.name === "maintance-tracker" && c.isTextBased());

  if (!channel || !channel.isTextBased()) {
    console.log(
      "⚠️ Maintenance-Tracker-Channel nicht gefunden. Nutze /config trackerkanal oder erstelle 'maintance-tracker'."
    );
    return;
  }

  const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
  if (!messages) return;

  const latest = messages.find(m => isMaintenanceCompletedMessage(m));
  if (!latest) return;

  if (data.lastMaintenanceMessageId === latest.id) return;

  const lastReset = data.lastMaintenanceResetAt
    ? new Date(data.lastMaintenanceResetAt).getTime()
    : 0;

  if (latest.createdTimestamp > lastReset) {
    await processMaintenanceMessage(latest);
  } else {
    // Bereits vorhandene alte Maintenance-Nachricht markieren,
    // damit sie beim nächsten Start nicht als neuer Reset behandelt wird.
    data.lastMaintenanceMessageId = latest.id;
    saveData();
  }
}

function buildCommands() {
  return [
    new SlashCommandBuilder()
      .setName("help")
      .setDescription("Zeigt alle Bot-Befehle."),

    new SlashCommandBuilder()
      .setName("status")
      .setDescription("Zeigt den Status von Botzeiten."),

    new SlashCommandBuilder()
      .setName("zeit")
      .setDescription("Boss-Tracker verwalten.")
      .addSubcommand(s => s
        .setName("hinzufuegen")
        .setDescription("Neuen Boss-Tracker hinzufügen.")
        .addStringOption(o =>
          o.setName("name")
            .setDescription("Name des Bosses")
            .setRequired(true))
        .addIntegerOption(o =>
          o.setName("minuten")
            .setDescription("Spawn-Intervall in Minuten, z. B. 15")
            .setMinValue(1)
            .setMaxValue(10080)
            .setRequired(true))
        .addRoleOption(o =>
          o.setName("rolle")
            .setDescription("Rolle, die gepingt werden soll")
            .setRequired(false))
        .addBooleanOption(o =>
          o.setName("erinnerungen")
            .setDescription("10 und 5 Minuten vorher erinnern")
            .setRequired(false)))
      .addSubcommand(s => s
        .setName("anzeigen")
        .setDescription("Zeigt alle Boss-Tracker."))
      .addSubcommand(s => s
        .setName("bearbeiten")
        .setDescription("Bearbeitet einen Boss-Tracker.")
        .addIntegerOption(o =>
          o.setName("id")
            .setDescription("ID des Trackers")
            .setRequired(true))
        .addStringOption(o =>
          o.setName("name")
            .setDescription("Neuer Name")
            .setRequired(false))
        .addIntegerOption(o =>
          o.setName("minuten")
            .setDescription("Neues Spawn-Intervall in Minuten")
            .setMinValue(1)
            .setMaxValue(10080)
            .setRequired(false))
        .addRoleOption(o =>
          o.setName("rolle")
            .setDescription("Neue Ping-Rolle")
            .setRequired(false))
        .addBooleanOption(o =>
          o.setName("erinnerungen")
            .setDescription("10 und 5 Minuten vorher")
            .setRequired(false)))
      .addSubcommand(s => s
        .setName("loeschen")
        .setDescription("Löscht einen Boss-Tracker.")
        .addIntegerOption(o =>
          o.setName("id")
            .setDescription("ID des Trackers")
            .setRequired(true)))
      .addSubcommand(s => s
        .setName("reset")
        .setDescription("Setzt alle Boss-Tracker sofort zurück.")),

    new SlashCommandBuilder()
      .setName("youtube")
      .setDescription("YouTube-Live-Benachrichtigungen verwalten.")
      .addSubcommand(s => s
        .setName("hinzufuegen")
        .setDescription("YouTube-Kanal überwachen.")
        .addStringOption(o =>
          o.setName("kanal")
            .setDescription("YouTube URL, @Handle oder Kanal-ID")
            .setRequired(true))
        .addChannelOption(o =>
          o.setName("discordkanal")
            .setDescription("Discord-Kanal für den Live-Ping")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true))
        .addRoleOption(o =>
          o.setName("rolle")
            .setDescription("Rolle, die gepingt werden soll")
            .setRequired(true)))
      .addSubcommand(s => s
        .setName("anzeigen")
        .setDescription("Zeigt überwachte YouTube-Kanäle."))
      .addSubcommand(s => s
        .setName("entfernen")
        .setDescription("Entfernt einen YouTube-Kanal.")
        .addIntegerOption(o =>
          o.setName("id")
            .setDescription("ID des Eintrags")
            .setRequired(true)))
      .addSubcommand(s => s
        .setName("test")
        .setDescription("Sendet eine Testbenachrichtigung.")
        .addIntegerOption(o =>
          o.setName("id")
            .setDescription("ID des YouTube-Eintrags")
            .setRequired(true))),

    new SlashCommandBuilder()
      .setName("config")
      .setDescription("Bot konfigurieren.")
      .addSubcommand(s => s
        .setName("kanal")
        .setDescription("Standard-Meldekanal für Bosszeiten.")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Textkanal")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)))
      .addSubcommand(s => s
        .setName("moderator")
        .setDescription("Moderator-Rolle festlegen.")
        .addRoleOption(o =>
          o.setName("rolle")
            .setDescription("Rolle mit Bot-Verwaltungsrechten")
            .setRequired(true)))
      .addSubcommand(s => s
        .setName("trackerkanal")
        .setDescription("Maintenance-Tracker-Kanal festlegen.")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Channel mit Maintenance-Meldungen")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)))
  ].map(c => c.toJSON());
}

const commands = buildCommands();

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  const route = Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID);
  await rest.put(route, { body: commands });
  console.log(
    "Slash-Commands registriert:",
    commands.map(c => c.name).join(", ")
  );
}

async function resolveYouTubeChannel(input) {
  let channelId = null;
  const trimmed = input.trim();

  const idMatch = trimmed.match(/(?:channel\/)(UC[\w-]{20,})/i);
  if (idMatch) channelId = idMatch[1];

  if (!channelId && /^UC[\w-]{20,}$/.test(trimmed)) channelId = trimmed;

  if (!channelId) {
    const handleMatch = trimmed.match(/(?:youtube\.com\/)?@([A-Za-z0-9._-]+)/i);
    if (!handleMatch) {
      throw new Error(
        "Kein gültiger YouTube-Kanal erkannt. Nutze eine /channel/UC... URL, eine @Handle-URL oder eine Kanal-ID."
      );
    }

    if (!YOUTUBE_API_KEY) {
      throw new Error(
        "YOUTUBE_API_KEY fehlt in der .env. Für @Handles wird der YouTube-API-Key benötigt."
      );
    }

    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "channel");
    url.searchParams.set("q", handleMatch[1]);
    url.searchParams.set("maxResults", "5");
    url.searchParams.set("key", YOUTUBE_API_KEY);

    const res = await fetch(url);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message || "YouTube API Fehler.");

    const item = json.items?.[0];
    if (!item?.id?.channelId) {
      throw new Error("YouTube-Kanal konnte nicht gefunden werden.");
    }

    channelId = item.id.channelId;
  }

  if (!YOUTUBE_API_KEY) {
    throw new Error("YOUTUBE_API_KEY fehlt in der .env.");
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("id", channelId);
  url.searchParams.set("key", YOUTUBE_API_KEY);

  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || "YouTube API Fehler.");

  const item = json.items?.[0];
  if (!item) throw new Error("YouTube-Kanal wurde nicht gefunden.");

  return {
    id: channelId,
    name: item.snippet?.title || channelId,
    url: `https://www.youtube.com/channel/${channelId}`
  };
}

async function checkYouTube() {
  if (!YOUTUBE_API_KEY || !data.youtube.length) return;

  for (const entry of data.youtube) {
    try {
      const url = new URL("https://www.googleapis.com/youtube/v3/search");
      url.searchParams.set("part", "snippet");
      url.searchParams.set("channelId", entry.channelId);
      url.searchParams.set("eventType", "live");
      url.searchParams.set("type", "video");
      url.searchParams.set("maxResults", "1");
      url.searchParams.set("key", YOUTUBE_API_KEY);

      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || "YouTube API Fehler.");

      const live = json.items?.[0];

      if (!live) {
        entry.currentLiveId = null;
        continue;
      }

      const videoId = live.id?.videoId;
      if (!videoId || entry.lastLiveId === videoId) continue;

      const ch = await client.channels.fetch(entry.discordChannelId).catch(() => null);
      if (!ch || !ch.isTextBased()) continue;

      const title = live.snippet?.title || "Live";

      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("🔴 YouTube LIVE")
        .setDescription(`**${entry.name}** ist jetzt live!`)
        .addFields({ name: "Stream", value: title })
        .setURL(`https://www.youtube.com/watch?v=${videoId}`)
        .setTimestamp();

      await ch.send({
        content: `${roleMention(entry.roleId)}\n🔴 **${entry.name} ist jetzt live!**`,
        embeds: [embed],
        allowedMentions: {
          roles: entry.roleId ? [entry.roleId] : []
        }
      });

      entry.lastLiveId = videoId;
      entry.currentLiveId = videoId;
      saveData();

      console.log(`YouTube LIVE gemeldet: ${entry.name} (${videoId})`);
    } catch (err) {
      console.error(`YouTube-Fehler bei ${entry.name}:`, err.message);
    }
  }
}

function helpEmbed() {
  return new EmbedBuilder()
    .setTitle("🤖 Botzeiten")
    .setDescription("Übersicht über die verfügbaren Befehle.")
    .addFields(
      {
        name: "⏰ Boss-Tracker",
        value:
          "`/zeit hinzufügen` – Tracker mit Intervall anlegen\n" +
          "`/zeit anzeigen` – alle Tracker\n" +
          "`/zeit bearbeiten` – Intervall ändern\n" +
          "`/zeit löschen` – Tracker entfernen\n" +
          "`/zeit reset` – alle Tracker sofort resetten\n\n" +
          "**Intervall:** Minuten eingeben, z. B. `15` = alle 15 Minuten, `120` = alle 2 Stunden."
      },
      {
        name: "📺 YouTube",
        value:
          "`/youtube hinzufügen` – Kanal überwachen\n" +
          "`/youtube anzeigen` – Kanäle anzeigen\n" +
          "`/youtube entfernen` – Kanal entfernen\n" +
          "`/youtube test` – Benachrichtigung testen"
      },
      {
        name: "⚙️ Konfiguration",
        value:
          "`/config kanal` – Boss-Meldekanal\n" +
          "`/config moderator` – Moderator-Rolle\n" +
          "`/config trackerkanal` – Maintenance-Tracker-Channel"
      },
      {
        name: "ℹ️ Sonstiges",
        value: "`/status` – Botstatus"
      }
    )
    .setFooter({ text: "Botzeiten • Europe/Berlin" });
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once("ready", async () => {
  console.log(`Eingeloggt als ${client.user.tag}`);
  console.log(`Zeitzone: ${TIMEZONE}`);

  await registerCommands().catch(err =>
    console.error("Command-Registrierung:", err.message)
  );

  // Vorhandene alte Daten werden beim Start in Minuten migriert.
  saveData();

  await checkMaintenanceHistory();
  await checkTimes();
  await checkYouTube();

  setInterval(checkTimes, 15000);
  setInterval(checkYouTube, 60000);
  setInterval(checkMaintenanceHistory, 30000);
});

client.on("messageCreate", async message => {
  try {
    await processMaintenanceMessage(message);
  } catch (err) {
    console.error("Maintenance-Tracker-Fehler:", err);
  }
});

client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  try {
    if (i.commandName === "help") {
      return i.reply({ embeds: [helpEmbed()] });
    }

    if (i.commandName === "status") {
      const { time } = nowBerlin();

      const maintenanceValue = data.maintenanceChannelId
        ? channelMention(data.maintenanceChannelId)
        : "#maintance-tracker";

      const nextReset = data.lastMaintenanceResetAt
        ? `<t:${Math.floor(new Date(data.lastMaintenanceResetAt).getTime() / 1000)}:F>`
        : "Noch keiner";

      const embed = new EmbedBuilder()
        .setTitle("📊 Botzeiten Status")
        .addFields(
          { name: "🟢 Bot", value: "Online", inline: true },
          { name: "🕐 Zeit", value: time, inline: true },
          { name: "⏰ Boss-Tracker", value: String(data.events.length), inline: true },
          { name: "📺 YouTube", value: String(data.youtube.length), inline: true },
          { name: "🛠️ Maintenance", value: maintenanceValue, inline: true },
          { name: "🔄 Letzter Reset", value: nextReset, inline: true },
          { name: "🔔 Meldekanal", value: channelMention(data.channelId) || "Nicht gesetzt", inline: true },
          { name: "🛡️ Moderator", value: roleMention(data.moderatorRoleId) || "Nicht gesetzt", inline: true }
        )
        .setFooter({ text: `Zeitzone: ${TIMEZONE}` })
        .setTimestamp();

      return i.reply({ embeds: [embed] });
    }

    if (i.commandName === "zeit") {
      const sub = i.options.getSubcommand();

      if (sub === "anzeigen") {
        if (!data.events.length) {
          return i.reply("⏰ Es sind keine Bosszeiten eingerichtet.");
        }

        const lines = data.events.map(e => {
          const next = getNextSpawnDate(e);
          const nextText = next
            ? `<t:${Math.floor(next.getTime() / 1000)}:R> (<t:${Math.floor(next.getTime() / 1000)}:t>)`
            : "nicht gesetzt";

          return `**#${e.id} ${e.name}** – **${formatInterval(getIntervalMinutes(e))}** → nächster Spawn ${nextText} ${e.reminders !== false ? "🔔 10/5 Min" : "🔕"} ${roleMention(e.roleId)}`;
        });

        return i.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("⏰ Bosszeiten")
              .setDescription(lines.join("\n"))
              .setTimestamp()
          ]
        });
      }

      if (!canManage(i.member)) return deny(i);

      if (sub === "hinzufuegen") {
        const name = i.options.getString("name", true);
        const intervalMinutes = i.options.getInteger("minuten", true);
        const role = i.options.getRole("rolle");
        const reminders = i.options.getBoolean("erinnerungen") ?? true;

        const nextId = data.events.length
          ? Math.max(...data.events.map(e => Number(e.id) || 0)) + 1
          : 1;

        const nextSpawnAt = new Date(
          Date.now() + intervalMinutes * 60 * 1000
        ).toISOString();

        data.events.push({
          id: nextId,
          name,
          intervalMinutes,
          nextSpawnAt,
          roleId: role?.id || null,
          reminders,
          channelId: data.channelId,
          lastReminder10: null,
          lastReminder5: null,
          lastTriggered: null
        });

        saveData();

        return i.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("✅ Boss-Tracker erstellt")
              .setDescription(
                `**${name}** spawnt ab jetzt **${formatInterval(intervalMinutes)}**.`
              )
              .addFields(
                {
                  name: "⏭️ Erster Spawn",
                  value: `<t:${Math.floor(new Date(nextSpawnAt).getTime() / 1000)}:F>`,
                  inline: true
                },
                {
                  name: "🔔 Erinnerungen",
                  value: reminders ? "10 und 5 Minuten vorher" : "Deaktiviert",
                  inline: true
                },
                {
                  name: "👤 Rolle",
                  value: roleMention(role?.id) || "Keine",
                  inline: true
                }
              )
          ]
        });
      }

      if (sub === "bearbeiten") {
        const id = i.options.getInteger("id", true);
        const e = data.events.find(x => Number(x.id) === id);

        if (!e) {
          return i.reply({
            content: "❌ Bosszeit nicht gefunden.",
            ephemeral: true
          });
        }

        const name = i.options.getString("name");
        const intervalMinutes = i.options.getInteger("minuten");
        const role = i.options.getRole("rolle");
        const reminders = i.options.getBoolean("erinnerungen");

        if (name !== null) e.name = name;

        if (intervalMinutes !== null) {
          e.intervalMinutes = intervalMinutes;
          e.nextSpawnAt = new Date(
            Date.now() + intervalMinutes * 60 * 1000
          ).toISOString();
          e.lastReminder10 = null;
          e.lastReminder5 = null;
          e.lastTriggered = null;
        }

        if (role) e.roleId = role.id;
        if (reminders !== null) e.reminders = reminders;

        delete e.intervalHours;
        saveData();

        return i.reply(
          `✅ **#${id} ${e.name}** wurde aktualisiert. ${formatInterval(getIntervalMinutes(e))}`
        );
      }

      if (sub === "loeschen") {
        const id = i.options.getInteger("id", true);
        const before = data.events.length;

        data.events = data.events.filter(x => Number(x.id) !== id);

        if (data.events.length === before) {
          return i.reply({
            content: "❌ Bosszeit nicht gefunden.",
            ephemeral: true
          });
        }

        saveData();
        return i.reply(`🗑️ Boss-Tracker **#${id}** wurde gelöscht.`);
      }

      if (sub === "reset") {
        resetAllTrackers("Manueller Reset");
        return i.reply(
          "🔄 Alle Boss-Tracker wurden sofort zurückgesetzt. Die Intervalle laufen jetzt erneut ab dem Reset."
        );
      }
    }

    if (i.commandName === "youtube") {
      const sub = i.options.getSubcommand();

      if (sub === "anzeigen") {
        if (!data.youtube.length) {
          return i.reply("📺 Es werden keine YouTube-Kanäle überwacht.");
        }

        const lines = data.youtube.map(e =>
          `**#${e.id} ${e.name}** → ${channelMention(e.discordChannelId)} → ${roleMention(e.roleId)}`
        );

        return i.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("📺 YouTube-Überwachung")
              .setDescription(lines.join("\n"))
          ]
        });
      }

      if (!canManage(i.member)) return deny(i);

      if (sub === "hinzufuegen") {
        if (!YOUTUBE_API_KEY) {
          return i.reply({
            content: "❌ `YOUTUBE_API_KEY` fehlt in der `.env`.",
            ephemeral: true
          });
        }

        const input = i.options.getString("kanal", true);
        const discordChannel = i.options.getChannel("discordkanal", true);
        const role = i.options.getRole("rolle", true);

        await i.deferReply({ ephemeral: true });

        try {
          const yt = await resolveYouTubeChannel(input);

          if (data.youtube.some(x => x.channelId === yt.id)) {
            return i.editReply(
              "❌ Dieser YouTube-Kanal wird bereits überwacht."
            );
          }

          const nextId = data.youtube.length
            ? Math.max(...data.youtube.map(e => Number(e.id) || 0)) + 1
            : 1;

          data.youtube.push({
            id: nextId,
            channelId: yt.id,
            name: yt.name,
            url: yt.url,
            discordChannelId: discordChannel.id,
            roleId: role.id,
            lastLiveId: null,
            currentLiveId: null
          });

          saveData();

          return i.editReply(
            `✅ **${yt.name}** wurde hinzugefügt.\n📢 ${channelMention(discordChannel.id)}\n🔔 ${roleMention(role.id)}`
          );
        } catch (err) {
          return i.editReply(`❌ ${err.message}`);
        }
      }

      if (sub === "entfernen") {
        const id = i.options.getInteger("id", true);
        const before = data.youtube.length;

        data.youtube = data.youtube.filter(x => Number(x.id) !== id);

        if (data.youtube.length === before) {
          return i.reply({
            content: "❌ YouTube-Eintrag nicht gefunden.",
            ephemeral: true
          });
        }

        saveData();
        return i.reply(`🗑️ YouTube-Eintrag **#${id}** wurde entfernt.`);
      }

      if (sub === "test") {
        const id = i.options.getInteger("id", true);
        const entry = data.youtube.find(x => Number(x.id) === id);

        if (!entry) {
          return i.reply({
            content: "❌ YouTube-Eintrag nicht gefunden.",
            ephemeral: true
          });
        }

        const ch = await client.channels
          .fetch(entry.discordChannelId)
          .catch(() => null);

        if (!ch || !ch.isTextBased()) {
          return i.reply({
            content: "❌ Discord-Meldekanal nicht erreichbar.",
            ephemeral: true
          });
        }

        await ch.send({
          content: `🧪 **YouTube-Test** ${roleMention(entry.roleId)}`,
          embeds: [
            new EmbedBuilder()
              .setTitle("🔴 YouTube LIVE – TEST")
              .setDescription(`Test für **${entry.name}**`)
              .setURL(entry.url)
          ],
          allowedMentions: {
            roles: [entry.roleId]
          }
        });

        return i.reply({
          content: "✅ Testbenachrichtigung gesendet.",
          ephemeral: true
        });
      }
    }

    if (i.commandName === "config") {
      const sub = i.options.getSubcommand();

      // /config moderator darf ausschließlich ein Administrator benutzen.
      if (sub === "moderator") {
        if (!isAdmin(i.member)) {
          return i.reply({
            content: "⛔ Nur Administratoren dürfen die Moderator-Rolle festlegen.",
            ephemeral: true
          });
        }

        const role = i.options.getRole("rolle", true);
        data.moderatorRoleId = role.id;
        saveData();

        return i.reply(
          `✅ ${roleMention(role.id)} kann den Bot jetzt vollständig verwalten.`
        );
      }

      if (!canManage(i.member)) return deny(i);

      if (sub === "kanal") {
        const channel = i.options.getChannel("channel", true);
        data.channelId = channel.id;

        for (const e of data.events) {
          e.channelId = channel.id;
        }

        saveData();
        return i.reply(
          `✅ Boss-Meldekanal ist jetzt ${channelMention(channel.id)}.`
        );
      }

      if (sub === "trackerkanal") {
        const channel = i.options.getChannel("channel", true);
        data.maintenanceChannelId = channel.id;
        saveData();

        return i.reply(
          `✅ Maintenance-Tracker ist jetzt ${channelMention(channel.id)}. Trigger: **RIBUT | MAINTENANCE COMPLETED**`
        );
      }
    }
  } catch (err) {
    console.error("Interaction-Fehler:", err);

    const msg = "❌ Bei der Ausführung ist ein Fehler aufgetreten.";

    if (i.replied || i.deferred) {
      return i.followUp({
        content: msg,
        ephemeral: true
      });
    }

    return i.reply({
      content: msg,
      ephemeral: true
    });
  }
});

client.login(TOKEN);
