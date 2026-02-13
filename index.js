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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
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

/* ================= QUIZ SYSTEM ================= */

const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;

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
