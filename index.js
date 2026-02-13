const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  PermissionsBitField
} = require("discord.js");

const Database = require("better-sqlite3");

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN) throw new Error("Missing TOKEN");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

/* ================= DATABASE ================= */

const db = new Database("bot.db");

db.prepare(`
  CREATE TABLE IF NOT EXISTS trial_mod (
    user_id TEXT PRIMARY KEY,
    start_ts INTEGER NOT NULL,
    last_attempt_ts INTEGER,
    last_score INTEGER
  )
`).run();

/* ================= TIER CONFIG ================= */

// Your existing Tier IDs
const T4 = "1471641147314274354";
const T3 = "1471641311227678832";
const T2 = "1471643483256262737";
const T1 = "1471643527640387656";

const tierRoleIds = [T4, T3, T2, T1];

// Structure A mapping
const staffRoles = {
  T4: ["Executive", "Head Of Operations", "Board Of Directors (BOD)"],
  T3: ["Team Director", "Lead", "Staff Lead", "GFX Lead", "Content Lead"],
  T2: ["Admin", "Admin Apprentice", "Manager", "Manager Apprentice", "Sr. Mod"],
  T1: ["Moderator", "Trial Moderator", "Apprentice Mod"]
};

/* ================= TIER AUTO SYNC ================= */

client.on("guildMemberUpdate", async (oldMember, newMember) => {

  try {

    // Detect real role changes
    const added = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    const removed = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
    const changed = [...added.values(), ...removed.values()];

    // If only tier roles changed, ignore (prevents loop)
    if (changed.length && changed.every(r => tierRoleIds.includes(r.id))) return;

    const hasRoleName = (names) =>
      names.some(name =>
        newMember.roles.cache.some(role => role.name === name)
      );

    let correctTier = null;

    if (hasRoleName(staffRoles.T4)) correctTier = T4;
    else if (hasRoleName(staffRoles.T3)) correctTier = T3;
    else if (hasRoleName(staffRoles.T2)) correctTier = T2;
    else if (hasRoleName(staffRoles.T1)) correctTier = T1;

    const currentTier = tierRoleIds.find(id =>
      newMember.roles.cache.has(id)
    );

    if (currentTier === correctTier) return;

    if (currentTier) {
      await newMember.roles.remove(currentTier).catch(() => {});
    }

    if (correctTier) {
      await newMember.roles.add(correctTier).catch(() => {});
    }

  } catch (err) {
    console.error("Tier sync error:", err);
  }

});

/* ================= QUIZ SYSTEM ================= */

const QUESTIONS = [
  { q: "What should you do first when a rule is broken?", a: ["Ignore", "Handle calmly", "Argue"], c: 1 },
  { q: "When should you escalate?", a: ["Serious violation", "Small typo", "Never"], c: 0 },
  { q: "How should staff act in conflicts?", a: ["Stay calm", "Take sides", "React emotionally"], c: 0 },
  { q: "Unsure about punishment?", a: ["Ask higher staff", "Guess", "Ignore"], c: 0 },
  { q: "What represents good staff behavior?", a: ["Professionalism", "Ego", "Power abuse"], c: 0 }
];

const sessions = new Map();

/* ================= READY ================= */

client.once("ready", async () => {

  console.log(`Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName("trialquiz")
      .setDescription("Take Trial Moderator quiz")
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  if (GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, GUILD_ID),
      { body: commands }
    );
  } else {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
  }

  console.log("Commands registered.");

});

/* ================= QUIZ COMMAND ================= */

client.on("interactionCreate", async interaction => {

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "trialquiz") {

    sessions.set(interaction.user.id, { index: 0, score: 0 });

    const first = QUESTIONS[0];

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`quiz_${interaction.user.id}_0`)
      .setPlaceholder("Select answer")
      .addOptions(first.a.map((ans, i) => ({
        label: ans,
        value: i.toString()
      })));

    const row = new ActionRowBuilder().addComponents(menu);

    return interaction.reply({
      content: `**Q1:** ${first.q}`,
      components: [row],
      ephemeral: true
    });
  }

});

/* ================= QUIZ SELECT HANDLER ================= */

client.on("interactionCreate", async interaction => {

  if (!interaction.isStringSelectMenu()) return;

  const parts = interaction.customId.split("_");
  if (parts[0] !== "quiz") return;

  const userId = parts[1];
  const index = parseInt(parts[2]);

  if (interaction.user.id !== userId)
    return interaction.reply({ content: "Not your quiz.", ephemeral: true });

  const session = sessions.get(userId);
  if (!session)
    return interaction.reply({ content: "Session expired.", ephemeral: true });

  const answer = parseInt(interaction.values[0]);
  const question = QUESTIONS[index];

  if (answer === question.c) session.score++;
  session.index++;

  if (session.index >= QUESTIONS.length) {

    sessions.delete(userId);

    if (session.score >= 4) {
      return interaction.update({
        content: `Passed! Score: ${session.score}/5`,
        components: []
      });
    } else {
      return interaction.update({
        content: `Failed. Score: ${session.score}/5`,
        components: []
      });
    }
  }

  const next = QUESTIONS[session.index];

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`quiz_${userId}_${session.index}`)
    .setPlaceholder("Select answer")
    .addOptions(next.a.map((ans, i) => ({
      label: ans,
      value: i.toString()
    })));

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.update({
    content: `**Q${session.index + 1}:** ${next.q}`,
    components: [row]
  });
});

client.login(TOKEN);
