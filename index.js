require("dotenv").config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require("discord.js");
const fs = require("fs");

const DATA_FILE = "./data.json";
const TIMEZONE = process.env.TIMEZONE || "Europe/Berlin";
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function loadData(){ try{return JSON.parse(fs.readFileSync(DATA_FILE,"utf8"));}catch{return {channelId:"",events:[]};} }
function saveData(d){fs.writeFileSync(DATA_FILE,JSON.stringify(d,null,2),"utf8");}
let data=loadData();

function nowBerlin(){
  const p=new Intl.DateTimeFormat("de-DE",{timeZone:TIMEZONE,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
  const g=t=>p.find(x=>x.type===t)?.value;
  return {date:`${g("year")}-${g("month")}-${g("day")}`,time:`${g("hour")}:${g("minute")}`};
}
function nextId(){return data.events.length?Math.max(...data.events.map(e=>Number(e.id)||0))+1:1;}
function validTime(v){return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);}
function canManage(i){return i.memberPermissions?.has(PermissionFlagsBits.ManageGuild);}

const commands=[
 new SlashCommandBuilder().setName("help").setDescription("Zeigt alle verfügbaren Bot-Befehle an."),
 new SlashCommandBuilder().setName("zeit").setDescription("Verwalte tägliche Bot-/Bosszeiten.")
  .addSubcommand(s=>s.setName("hinzufuegen").setDescription("Neue tägliche Zeit hinzufügen.")
   .addStringOption(o=>o.setName("name").setDescription("Name des Bots/Bosses").setRequired(true))
   .addStringOption(o=>o.setName("uhrzeit").setDescription("HH:MM, z.B. 15:15").setRequired(true))
   .addRoleOption(o=>o.setName("rolle").setDescription("Rolle, die erwähnt werden soll").setRequired(true)))
  .addSubcommand(s=>s.setName("liste").setDescription("Alle gespeicherten Zeiten anzeigen."))
  .addSubcommand(s=>s.setName("loeschen").setDescription("Eine Zeit löschen.")
   .addIntegerOption(o=>o.setName("id").setDescription("ID aus /zeit liste").setRequired(true)))
  .addSubcommand(s=>s.setName("aendern").setDescription("Eine vorhandene Zeit ändern.")
   .addIntegerOption(o=>o.setName("id").setDescription("ID aus /zeit liste").setRequired(true))
   .addStringOption(o=>o.setName("name").setDescription("Neuer Name").setRequired(true))
   .addStringOption(o=>o.setName("uhrzeit").setDescription("Neue Uhrzeit HH:MM").setRequired(true))
   .addRoleOption(o=>o.setName("rolle").setDescription("Neue Rolle").setRequired(true)))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
 new SlashCommandBuilder().setName("config").setDescription("Bot konfigurieren.")
  .addSubcommand(s=>s.setName("kanal").setDescription("Meldekanal festlegen.")
   .addChannelOption(o=>o.setName("channel").setDescription("Textkanal").addChannelTypes(ChannelType.GuildText).setRequired(true)))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map(c=>c.toJSON());

async function registerCommands(){
 const rest=new REST({version:"10"}).setToken(process.env.DISCORD_TOKEN);
 const route=process.env.GUILD_ID?Routes.applicationGuildCommands(process.env.CLIENT_ID,process.env.GUILD_ID):Routes.applicationCommands(process.env.CLIENT_ID);
 await rest.put(route,{body:commands});
 console.log("Slash-Commands registriert.");
}

client.once("ready",()=>{
 console.log(`Eingeloggt als ${client.user.tag}`);
 console.log(`Zeitzone: ${TIMEZONE}`);
 checkTimes(); setInterval(checkTimes,15000);
});

async function checkTimes(){
 const {date,time}=nowBerlin(); let changed=false;
 for(const e of data.events){
  if(e.time!==time||e.lastTriggered===date) continue;
  try{
   const ch=await client.channels.fetch(data.channelId);
   if(!ch||!ch.isTextBased()) continue;
   await ch.send({content:`🔔 **${e.name}**\nDie eingetragene Zeit ist jetzt! ${e.roleId?`<@&${e.roleId}>`:""}`,allowedMentions:{roles:e.roleId?[e.roleId]:[]}});
   e.lastTriggered=date; changed=true;
   console.log(`[${date} ${time}] ${e.name} gemeldet.`);
  }catch(err){console.error(`Fehler bei "${e.name}":`,err.message);}
 }
 if(changed) saveData(data);
}

client.on("interactionCreate",async i=>{
 if(!i.isChatInputCommand()) return;

 if(i.commandName==="help"){
  const embed=new EmbedBuilder()
   .setTitle("🤖 Botzeiten – Hilfe")
   .setDescription("Hier findest du alle verfügbaren Befehle.")
   .addFields(
    {name:"⏰ Zeitverwaltung",value:"`/zeit hinzufuegen` – Neue Botzeit erstellen\n`/zeit liste` – Alle Botzeiten anzeigen\n`/zeit aendern` – Eine Botzeit ändern\n`/zeit loeschen` – Eine Botzeit löschen"},
    {name:"⚙️ Konfiguration",value:"`/config kanal` – Meldekanal festlegen"},
    {name:"ℹ️ Allgemein",value:"`/help` – Diese Hilfe anzeigen"}
   ).setFooter({text:"Botzeiten • Europe/Berlin"});
  return i.reply({embeds:[embed]});
 }

 if(!canManage(i)) return i.reply({content:"❌ Du brauchst die Berechtigung **Server verwalten**.",ephemeral:true});

 if(i.commandName==="config"){
  const ch=i.options.getChannel("channel"); data.channelId=ch.id; saveData(data);
  return i.reply(`✅ Der Meldekanal ist jetzt ${ch}.`);
 }

 const sub=i.options.getSubcommand();
 if(sub==="hinzufuegen"){
  const name=i.options.getString("name").trim(), time=i.options.getString("uhrzeit").trim(), role=i.options.getRole("rolle");
  if(!validTime(time)) return i.reply({content:"❌ Ungültige Uhrzeit. Verwende z.B. `15:15`.",ephemeral:true});
  data.events.push({id:nextId(),name,time,roleId:role.id,lastTriggered:null}); saveData(data);
  return i.reply(`✅ **${name}** wurde für **${time} Uhr** eingetragen und erwähnt ${role}.`);
 }
 if(sub==="liste"){
  if(!data.events.length) return i.reply("📭 Es sind noch keine Zeiten eingetragen.");
  const channel=data.channelId?`<#${data.channelId}>`:"❌ Kein Meldekanal";
  const lines=data.events.slice().sort((a,b)=>a.time.localeCompare(b.time)).map(e=>`**#${e.id}** — ⏰ **${e.time}** — **${e.name}** — <@&${e.roleId}>`).join("\n");
  return i.reply(`📋 **Gespeicherte Botzeiten**\nMeldekanal: ${channel}\n\n${lines}`);
 }
 if(sub==="loeschen"){
  const id=i.options.getInteger("id"), idx=data.events.findIndex(e=>e.id===id);
  if(idx===-1) return i.reply({content:`❌ Keine Zeit mit ID **${id}** gefunden.`,ephemeral:true});
  const e=data.events.splice(idx,1)[0]; saveData(data); return i.reply(`🗑️ **${e.name}** um **${e.time} Uhr** wurde gelöscht.`);
 }
 if(sub==="aendern"){
  const id=i.options.getInteger("id"), e=data.events.find(e=>e.id===id);
  const name=i.options.getString("name").trim(), time=i.options.getString("uhrzeit").trim(), role=i.options.getRole("rolle");
  if(!validTime(time)) return i.reply({content:"❌ Ungültige Uhrzeit. Verwende z.B. `15:15`.",ephemeral:true});
  if(!e) return i.reply({content:`❌ Keine Zeit mit ID **${id}** gefunden.`,ephemeral:true});
  Object.assign(e,{name,time,roleId:role.id,lastTriggered:null}); saveData(data);
  return i.reply(`✏️ **#${id}** wurde geändert: **${name} — ${time} Uhr — ${role}**`);
 }
});

async function main(){
 if(!process.env.DISCORD_TOKEN||!process.env.CLIENT_ID){console.error("DISCORD_TOKEN und CLIENT_ID müssen in .env gesetzt werden.");process.exit(1);}
 await registerCommands(); await client.login(process.env.DISCORD_TOKEN);
}
main().catch(console.error);
