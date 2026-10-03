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
    return {
      ...structuredClone(defaultData),
      ...raw,
      events: Array.isArray(raw.events) ? raw.events : [],
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

function timeMinusMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(":").map(Number);
  let total = h * 60 + m - minutes;
  total = (total + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
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
      .setDescription("Bosszeiten verwalten.")
      .addSubcommand(s => s
        .setName("hinzufuegen")
        .setDescription("Neue Bosszeit hinzufügen.")
        .addStringOption(o => o.setName("name").setDescription("Name des Bosses").setRequired(true))
        .addStringOption(o => o.setName("uhrzeit").setDescription("HH:MM, z. B. 18:00").setRequired(true))
        .addRoleOption(o => o.setName("rolle").setDescription("Rolle, die gepingt werden soll").setRequired(false))
        .addBooleanOption(o => o.setName("erinnerungen").setDescription("10 und 5 Minuten vorher erinnern").setRequired(false)))
      .addSubcommand(s => s
        .setName("anzeigen")
        .setDescription("Zeigt alle Bosszeiten."))
      .addSubcommand(s => s
        .setName("bearbeiten")
        .setDescription("Bearbeitet eine Bosszeit.")
        .addIntegerOption(o => o.setName("id").setDescription("ID der Bosszeit").setRequired(true))
        .addStringOption(o => o.setName("name").setDescription("Neuer Name").setRequired(false))
        .addStringOption(o => o.setName("uhrzeit").setDescription("Neue Uhrzeit HH:MM").setRequired(false))
        .addRoleOption(o => o.setName("rolle").setDescription("Neue Ping-Rolle").setRequired(false))
        .addBooleanOption(o => o.setName("erinnerungen").setDescription("10 und 5 Minuten vorher").setRequired(false)))
      .addSubcommand(s => s
        .setName("loeschen")
        .setDescription("Löscht eine Bosszeit.")
        .addIntegerOption(o => o.setName("id").setDescription("ID der Bosszeit").setRequired(true))),

    new SlashCommandBuilder()
      .setName("youtube")
      .setDescription("YouTube-Live-Benachrichtigungen verwalten.")
      .addSubcommand(s => s
        .setName("hinzufuegen")
        .setDescription("YouTube-Kanal überwachen.")
        .addStringOption(o => o.setName("kanal").setDescription("YouTube URL, @Handle oder Kanal-ID").setRequired(true))
        .addChannelOption(o => o.setName("discordkanal").setDescription("Discord-Kanal für den Live-Ping").addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addRoleOption(o => o.setName("rolle").setDescription("Rolle, die gepingt werden soll").setRequired(true)))
      .addSubcommand(s => s
        .setName("anzeigen")
        .setDescription("Zeigt überwachte YouTube-Kanäle."))
      .addSubcommand(s => s
        .setName("entfernen")
        .setDescription("Entfernt einen YouTube-Kanal.")
        .addIntegerOption(o => o.setName("id").setDescription("ID des Eintrags").setRequired(true)))
      .addSubcommand(s => s
        .setName("test")
        .setDescription("Sendet eine Testbenachrichtigung.")
        .addIntegerOption(o => o.setName("id").setDescription("ID des YouTube-Eintrags").setRequired(true))),

    new SlashCommandBuilder()
      .setName("config")
      .setDescription("Bot konfigurieren.")
      .addSubcommand(s => s
        .setName("kanal")
        .setDescription("Standard-Meldekanal für Bosszeiten.")
        .addChannelOption(o => o.setName("channel").setDescription("Textkanal").addChannelTypes(ChannelType.GuildText).setRequired(true)))
      .addSubcommand(s => s
        .setName("moderator")
        .setDescription("Moderator-Rolle festlegen.")
        .addRoleOption(o => o.setName("rolle").setDescription("Rolle mit Bot-Verwaltungsrechten").setRequired(true)))
  ].map(c => c.toJSON());
}

const commands = buildCommands();

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  const route = Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID);
  await rest.put(route, { body: commands });
  console.log("Slash-Commands registriert:", commands.map(c => c.name).join(", "));
}

async function resolveYouTubeChannel(input) {
  let channelId = null;
  const trimmed = input.trim();

  const idMatch = trimmed.match(/(?:channel\/)(UC[\w-]{20,})/i);
  if (idMatch) channelId = idMatch[1];

  if (!channelId && /^UC[\w-]{20,}$/.test(trimmed)) channelId = trimmed;

  if (!channelId) {
    const handleMatch = trimmed.match(/(?:youtube\.com\/)?@([A-Za-z0-9._-]+)/i);
    if (!handleMatch) throw new Error("Kein gültiger YouTube-Kanal erkannt. Nutze eine /channel/UC... URL, eine @Handle-URL oder eine Kanal-ID.");
    if (!YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY fehlt in der .env. Für @Handles wird der YouTube-API-Key benötigt.");

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
    if (!item?.id?.channelId) throw new Error("YouTube-Kanal konnte nicht gefunden werden.");
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
        allowedMentions: { roles: entry.roleId ? [entry.roleId] : [] }
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

async function checkTimes() {
  const { date, time } = nowBerlin();
  let changed = false;

  for (const e of data.events) {
    if (!e.time) continue;

    const reminder10 = timeMinusMinutes(e.time, 10);
    const reminder5 = timeMinusMinutes(e.time, 5);

    let reminderType = null;
    if (e.reminders !== false && time === reminder10 && e.lastReminder10 !== date) {
      reminderType = 10;
      e.lastReminder10 = date;
      changed = true;
    } else if (e.reminders !== false && time === reminder5 && e.lastReminder5 !== date) {
      reminderType = 5;
      e.lastReminder5 = date;
      changed = true;
    } else if (time === e.time && e.lastTriggered !== date) {
      reminderType = 0;
      e.lastTriggered = date;
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
        allowedMentions: { roles: e.roleId ? [e.roleId] : [] }
      });

      console.log(`[${date} ${time}] ${e.name}: ${reminderType === 0 ? "Start" : `${reminderType} Min Erinnerung`}`);
    } catch (err) {
      console.error(`Fehler bei "${e.name}":`, err.message);
    }
  }

  if (changed) saveData();
}

function helpEmbed() {
  return new EmbedBuilder()
    .setTitle("🤖 Botzeiten")
    .setDescription("Übersicht über die verfügbaren Befehle.")
    .addFields(
      {
        name: "⏰ Bosszeiten",
        value:
          "`/zeit hinzufügen` – neue Bosszeit\n" +
          "`/zeit anzeigen` – alle Zeiten\n" +
          "`/zeit bearbeiten` – Zeit ändern\n" +
          "`/zeit löschen` – Zeit entfernen"
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
          "`/config moderator` – Moderator-Rolle"
      },
      {
        name: "ℹ️ Sonstiges",
        value: "`/status` – Botstatus"
      }
    )
    .setFooter({ text: "Botzeiten • Europe/Berlin" });
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once("ready", async () => {
  console.log(`Eingeloggt als ${client.user.tag}`);
  console.log(`Zeitzone: ${TIMEZONE}`);
  await registerCommands().catch(err => console.error("Command-Registrierung:", err.message));
  await checkTimes();
  await checkYouTube();
  setInterval(checkTimes, 15000);
  setInterval(checkYouTube, 60000);
});

client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  try {
    if (i.commandName === "help") {
      return i.reply({ embeds: [helpEmbed()] });
    }

    if (i.commandName === "status") {
      const { time } = nowBerlin();
      const embed = new EmbedBuilder()
        .setTitle("📊 Botzeiten Status")
        .addFields(
          { name: "🟢 Bot", value: "Online", inline: true },
          { name: "🕐 Zeit", value: time, inline: true },
          { name: "⏰ Bosszeiten", value: String(data.events.length), inline: true },
          { name: "📺 YouTube", value: String(data.youtube.length), inline: true },
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
        if (!data.events.length) return i.reply("⏰ Es sind keine Bosszeiten eingerichtet.");
        const lines = data.events.map(e =>
          `**#${e.id} ${e.name}** – ${e.time} Uhr ${e.reminders !== false ? "🔔 10/5 Min" : "🔕"} ${roleMention(e.roleId)}`
        );
        return i.reply({
          embeds: [new EmbedBuilder().setTitle("⏰ Bosszeiten").setDescription(lines.join("\n")).setTimestamp()]
        });
      }

      if (!canManage(i.member)) return deny(i);

      if (sub === "hinzufuegen") {
        const name = i.options.getString("name", true);
        const time = i.options.getString("uhrzeit", true);
        const role = i.options.getRole("rolle");
        const reminders = i.options.getBoolean("erinnerungen") ?? true;
        if (!isValidTime(time)) return i.reply({ content: "❌ Die Uhrzeit muss im Format `HH:MM` sein, z. B. `18:00`.", ephemeral: true });

        const nextId = data.events.length ? Math.max(...data.events.map(e => Number(e.id) || 0)) + 1 : 1;
        data.events.push({
          id: nextId,
          name,
          time,
          roleId: role?.id || null,
          reminders,
          channelId: data.channelId,
          lastReminder10: null,
          lastReminder5: null,
          lastTriggered: null
        });
        saveData();

        return i.reply({
          embeds: [new EmbedBuilder()
            .setTitle("✅ Bosszeit erstellt")
            .setDescription(`**${name}** um **${time} Uhr**.`)
            .addFields(
              { name: "🔔 Erinnerungen", value: reminders ? "10 und 5 Minuten vorher" : "Deaktiviert", inline: true },
              { name: "👤 Rolle", value: roleMention(role?.id) || "Keine", inline: true }
            )]
        });
      }

      if (sub === "bearbeiten") {
        const id = i.options.getInteger("id", true);
        const e = data.events.find(x => Number(x.id) === id);
        if (!e) return i.reply({ content: "❌ Bosszeit nicht gefunden.", ephemeral: true });

        const name = i.options.getString("name");
        const time = i.options.getString("uhrzeit");
        const role = i.options.getRole("rolle");
        const reminders = i.options.getBoolean("erinnerungen");

        if (time && !isValidTime(time)) return i.reply({ content: "❌ Uhrzeit muss `HH:MM` sein.", ephemeral: true });
        if (name !== null) e.name = name;
        if (time !== null) {
          e.time = time;
          e.lastReminder10 = null;
          e.lastReminder5 = null;
          e.lastTriggered = null;
        }
        if (role) e.roleId = role.id;
        if (reminders !== null) e.reminders = reminders;
        saveData();

        return i.reply(`✅ **#${id} ${e.name}** wurde aktualisiert.`);
      }

      if (sub === "loeschen") {
        const id = i.options.getInteger("id", true);
        const before = data.events.length;
        data.events = data.events.filter(x => Number(x.id) !== id);
        if (data.events.length === before) return i.reply({ content: "❌ Bosszeit nicht gefunden.", ephemeral: true });
        saveData();
        return i.reply(`🗑️ Bosszeit **#${id}** wurde gelöscht.`);
      }
    }

    if (i.commandName === "youtube") {
      const sub = i.options.getSubcommand();

      if (sub === "anzeigen") {
        if (!data.youtube.length) return i.reply("📺 Es werden keine YouTube-Kanäle überwacht.");
        const lines = data.youtube.map(e =>
          `**#${e.id} ${e.name}** → ${channelMention(e.discordChannelId)} → ${roleMention(e.roleId)}`
        );
        return i.reply({
          embeds: [new EmbedBuilder().setTitle("📺 YouTube-Überwachung").setDescription(lines.join("\n"))]
        });
      }

      if (!canManage(i.member)) return deny(i);

      if (sub === "hinzufuegen") {
        if (!YOUTUBE_API_KEY) return i.reply({ content: "❌ `YOUTUBE_API_KEY` fehlt in der `.env`.", ephemeral: true });

        const input = i.options.getString("kanal", true);
        const discordChannel = i.options.getChannel("discordkanal", true);
        const role = i.options.getRole("rolle", true);

        await i.deferReply({ ephemeral: true });
        try {
          const yt = await resolveYouTubeChannel(input);
          if (data.youtube.some(x => x.channelId === yt.id)) return i.editReply("❌ Dieser YouTube-Kanal wird bereits überwacht.");

          const nextId = data.youtube.length ? Math.max(...data.youtube.map(e => Number(e.id) || 0)) + 1 : 1;
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

          return i.editReply(`✅ **${yt.name}** wurde hinzugefügt.\n📢 ${channelMention(discordChannel.id)}\n🔔 ${roleMention(role.id)}`);
        } catch (err) {
          return i.editReply(`❌ ${err.message}`);
        }
      }

      if (sub === "entfernen") {
        const id = i.options.getInteger("id", true);
        const before = data.youtube.length;
        data.youtube = data.youtube.filter(x => Number(x.id) !== id);
        if (data.youtube.length === before) return i.reply({ content: "❌ YouTube-Eintrag nicht gefunden.", ephemeral: true });
        saveData();
        return i.reply(`🗑️ YouTube-Eintrag **#${id}** wurde entfernt.`);
      }

      if (sub === "test") {
        const id = i.options.getInteger("id", true);
        const entry = data.youtube.find(x => Number(x.id) === id);
        if (!entry) return i.reply({ content: "❌ YouTube-Eintrag nicht gefunden.", ephemeral: true });

        const ch = await client.channels.fetch(entry.discordChannelId).catch(() => null);
        if (!ch || !ch.isTextBased()) return i.reply({ content: "❌ Discord-Meldekanal nicht erreichbar.", ephemeral: true });

        await ch.send({
          content: `🧪 **YouTube-Test** ${roleMention(entry.roleId)}`,
          embeds: [new EmbedBuilder().setTitle("🔴 YouTube LIVE – TEST").setDescription(`Test für **${entry.name}**`).setURL(entry.url)],
          allowedMentions: { roles: [entry.roleId] }
        });

        return i.reply({ content: "✅ Testbenachrichtigung gesendet.", ephemeral: true });
      }
    }

    if (i.commandName === "config") {
      if (!canManage(i.member)) return deny(i);
      const sub = i.options.getSubcommand();

      if (sub === "kanal") {
        const channel = i.options.getChannel("channel", true);
        data.channelId = channel.id;
        for (const e of data.events) e.channelId = channel.id;
        saveData();
        return i.reply(`✅ Boss-Meldekanal ist jetzt ${channelMention(channel.id)}.`);
      }

      if (sub === "moderator") {
        const role = i.options.getRole("rolle", true);
        if (!isAdmin(i.member)) {
          return i.reply({ content: "⛔ Nur Administratoren dürfen die Moderator-Rolle festlegen.", ephemeral: true });
        }
        data.moderatorRoleId = role.id;
        saveData();
        return i.reply(`✅ ${roleMention(role.id)} kann den Bot jetzt vollständig verwalten.`);
      }
    }
  } catch (err) {
    console.error("Interaction-Fehler:", err);
    const msg = "❌ Bei der Ausführung ist ein Fehler aufgetreten.";
    if (i.replied || i.deferred) return i.followUp({ content: msg, ephemeral: true });
    return i.reply({ content: msg, ephemeral: true });
  }
});

client.login(TOKEN);
