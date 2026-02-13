const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ChannelType,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");

const sqlite3 = require("sqlite3").verbose();

// =====================
// CONFIG (ENV VARS)
// =====================
const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID; // recommended for instant slash command updates
const MOD_ROLE_ID = process.env.MOD_ROLE_ID;
const TRIAL_ROLE_ID = process.env.TRIAL_ROLE_ID;
const QUIZ_LOG_CHANNEL_ID = process.env.QUIZ_LOG_CHANNEL_ID || null;

if (!TOKEN) throw new Error("Missing TOKEN env var.");
if (!MOD_ROLE_ID) throw new Error("Missing MOD_ROLE_ID env var.");
if (!TRIAL_ROLE_ID) throw new Error("Missing TRIAL_ROLE_ID env var.");

// =====================
// DISCORD CLIENT
// =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// =====================
// DATABASE (PERSISTENT STATE)
// =====================
const db = new sqlite3.Database("./bot.db");
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS trial_mod (
      user_id TEXT PRIMARY KEY,
      start_ts INTEGER NOT NULL,
      last_attempt_ts INTEGER,
      last_score INTEGER
    )
  `);
});

// Helper DB functions
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// =====================
// YOUR TIER ROLE IDS
// =====================
const T4 = "1471641147314274354";
const T3 = "1471641311227678832";
const T2 = "1471643483256262737";
const T1 = "1471643527640387656";
const tierRoles = [T4, T3, T2, T1];

// =====================
// UPDATED STAFF STRUCTURE (as requested)
// =====================
const staffRoles = {
  // 🔴 TOP
  T4: ["Executive", "Head Of Operations", "Board Of Directors (BOD)"],

  // 🟣 UPPER LEADERSHIP
  T3: ["Team Director", "Lead", "Staff Lead", "GFX Lead", "Content Lead"],

  // 🟡 MANAGEMENT / ADMIN
  T2: ["Admin", "Admin Apprentice", "Manager", "Manager Apprentice", "Sr. Mod"],

  // 🟢 MODERATION
  T1: ["Moderator", "Trial Moderator"],
};

// =====================
// PRIVATE VC SYSTEM
// =====================
const execRoles = staffRoles.T4;
const privateVCs = new Map(); // channelId -> ownerUserId

// =====================
// ENTERPRISE QUIZ SYSTEM
// =====================

// 14 days requirement
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
// 24 hour cooldown after fail
const FAIL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// 5-question pool (not hard)
const QUIZ_POOL = [
  {
    q: "What should you do first when someone breaks a rule?",
    choices: ["Ignore it", "Handle it calmly using the rules", "Start arguing"],
    correct: 1,
  },
  {
    q: "When should you escalate to Admin/Manager level?",
    choices: ["For serious violations or threats", "For any small typo", "Never escalate"],
    correct: 0,
  },
  {
    q: "Best way to deal with an angry member?",
    choices: ["Match their energy", "Stay calm and de-escalate", "Mute them instantly always"],
    correct: 1,
  },
  {
    q: "If you’re unsure what punishment to use, you should:",
    choices: ["Ask higher staff / check guidelines", "Guess", "Punish harder just in case"],
    correct: 0,
  },
  {
    q: "What is a key part of being staff?",
    choices: ["Fairness + consistency", "Power flexing", "Favoritism"],
    correct: 0,
  },
  {
    q: "Where should staff handle disagreements?",
    choices: ["Public chat", "Privately / staff channels", "In general chat with @everyone"],
    correct: 1,
  },
  {
    q: "What should you do with serious reports?",
    choices: ["Ignore if you’re busy", "Document and escalate if needed", "Leak it to friends"],
    correct: 1,
  },
];

// Active quiz sessions (in-memory, expires)
const quizSessions = new Map(); // userId -> { questions, index, score, guildId, startedTs }

// pick 5 random questions
function pickQuizQuestions() {
  const shuffled = [...QUIZ_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 5);
}

async function logQuiz(guild, message) {
  if (!QUIZ_LOG_CHANNEL_ID) return;
  const ch = guild.channels.cache.get(QUIZ_LOG_CHANNEL_ID);
  if (!ch) return;
  ch.send(message).catch(() => {});
}

function buildQuestionMenu(userId, qObj, qIndex, total) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`trialquiz:${userId}:${qIndex}`)
    .setPlaceholder(`Question ${qIndex + 1}/${total} — pick an answer`)
    .addOptions(
      qObj.choices.map((label, idx) => ({
        label,
        value: String(idx),
      }))
    );

  return new ActionRowBuilder().addComponents(menu);
}

// =====================
// SLASH COMMAND REGISTRATION
// =====================
async function registerCommands() {
  const commands = [
    // Private VC
    new SlashCommandBuilder()
      .setName("createvc")
      .setDescription("Create a private VC (Executive+)")
      .addStringOption((option) =>
        option.setName("name").setDescription("VC Name").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("givekey")
      .setDescription("Give VC access to a user (VC owner only)")
      .addUserOption((option) =>
        option.setName("user").setDescription("User to give access").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("removekey")
      .setDescription("Remove VC access from a user (VC owner only)")
      .addUserOption((option) =>
        option.setName("user").setDescription("User to remove").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("kickfromvc")
      .setDescription("Kick a user and revoke their VC key (VC owner only)")
      .addUserOption((option) =>
        option.setName("user").setDescription("User to kick").setRequired(true)
      ),

    // Trial Quiz
    new SlashCommandBuilder()
      .setName("trialquiz")
      .setDescription("Take the Trial Moderator promotion quiz (after 14 days)"),
  ].map((cmd) => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
      body: commands,
    });
    console.log("Registered GUILD slash commands.");
  } else {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("Registered GLOBAL slash commands (can take time to appear).");
  }
}

// =====================
// READY
// =====================
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
});

// =====================
// TIER AUTO SYNC (NO LOOP)
// =====================
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    // ----- Track Trial Moderator start time persistently -----
    const hadTrial = oldMember.roles.cache.has(TRIAL_ROLE_ID);
    const hasTrial = newMember.roles.cache.has(TRIAL_ROLE_ID);

    if (!hadTrial && hasTrial) {
      // assign start timestamp if not already tracked
      const existing = await dbGet(`SELECT user_id FROM trial_mod WHERE user_id = ?`, [
        newMember.id,
      ]);
      if (!existing) {
        await dbRun(`INSERT INTO trial_mod (user_id, start_ts) VALUES (?, ?)`, [
          newMember.id,
          Date.now(),
        ]);
      }
    }

    if (hadTrial && !hasTrial) {
      // removed trial role -> remove tracking
      await dbRun(`DELETE FROM trial_mod WHERE user_id = ?`, [newMember.id]);
    }

    // ----- Tier sync loop guard -----
    const changedRoles = [
      ...newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id)).values(),
      ...oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id)).values(),
    ];
    const onlyTierChange = changedRoles.length > 0 && changedRoles.every((r) => tierRoles.includes(r.id));
    if (onlyTierChange) return;

    const hasRoleName = (names) =>
      names.some((name) => newMember.roles.cache.some((role) => role.name === name));

    let correctTier = null;
    if (hasRoleName(staffRoles.T4)) correctTier = T4;
    else if (hasRoleName(staffRoles.T3)) correctTier = T3;
    else if (hasRoleName(staffRoles.T2)) correctTier = T2;
    else if (hasRoleName(staffRoles.T1)) correctTier = T1;

    const currentTier = tierRoles.find((id) => newMember.roles.cache.has(id)) || null;
    if (currentTier === correctTier) return;

    if (currentTier) await newMember.roles.remove(currentTier).catch(() => {});
    if (correctTier) await newMember.roles.add(correctTier).catch(() => {});
  } catch (err) {
    console.error("guildMemberUpdate error:", err);
  }
});

// =====================
// PRIVATE VC + QUIZ COMMANDS
// =====================
client.on("interactionCreate", async (interaction) => {
  try {
    // ---- SELECT MENU (QUIZ) ----
    if (interaction.isStringSelectMenu()) {
      const [prefix, userId, qIndexStr] = interaction.customId.split(":");
      if (prefix !== "trialquiz") return;

      // Security: only quiz owner can respond
      if (interaction.user.id !== userId) {
        return interaction.reply({ content: "This quiz isn’t for you.", ephemeral: true });
      }

      const session = quizSessions.get(userId);
      if (!session) {
        return interaction.reply({ content: "Quiz session expired. Run /trialquiz again.", ephemeral: true });
      }

      const qIndex = Number(qIndexStr);
      if (Number.isNaN(qIndex) || qIndex !== session.index) {
        return interaction.reply({ content: "Out of sync. Run /trialquiz again.", ephemeral: true });
      }

      const selected = Number(interaction.values[0]);
      const currentQ = session.questions[session.index];

      if (selected === currentQ.correct) session.score += 1;
      session.index += 1;

      // Next question or finish
      if (session.index >= session.questions.length) {
        const score = session.score; // out of 5
        quizSessions.delete(userId);

        // Persist attempt
        await dbRun(
          `UPDATE trial_mod SET last_attempt_ts = ?, last_score = ? WHERE user_id = ?`,
          [Date.now(), score, userId]
        );

        const guild = interaction.guild;
        const member = await guild.members.fetch(userId);

        if (score >= 4) {
          // PASS: promote
          await member.roles.remove(TRIAL_ROLE_ID).catch(() => {});
          await member.roles.add(MOD_ROLE_ID).catch(() => {});

          await logQuiz(
            guild,
            `✅ **Trial Quiz PASS** — <@${userId}> scored **${score}/5** and was promoted to **Moderator**.`
          );

          return interaction.update({
            content: `✅ **Passed!** You scored **${score}/5**.\nYou’ve been promoted to **Moderator**.`,
            components: [],
          });
        } else {
          await logQuiz(
            guild,
            `❌ **Trial Quiz FAIL** — <@${userId}> scored **${score}/5** (needs 4/5). Cooldown: 24h.`
          );

          return interaction.update({
            content: `❌ **Not quite.** You scored **${score}/5**.\nYou need **4/5** to pass.\nTry again in **24 hours**.`,
            components: [],
          });
        }
      }

      // show next question
      const nextQ = session.questions[session.index];
      const row = buildQuestionMenu(userId, nextQ, session.index, session.questions.length);

      return interaction.update({
        content: `**Trial Moderator Quiz**\n\n**Q${session.index + 1}:** ${nextQ.q}`,
        components: [row],
      });
    }

    // ---- SLASH COMMANDS ----
    if (!interaction.isChatInputCommand()) return;

    const member = interaction.member;
    const guild = interaction.guild;

    // ===== PRIVATE VC COMMANDS =====
    if (interaction.commandName === "createvc") {
      const hasExecRole = execRoles.some((roleName) =>
        member.roles.cache.some((r) => r.name === roleName)
      );

      if (!hasExecRole) {
        return interaction.reply({ content: "You must be Executive+ to create private VCs.", ephemeral: true });
      }

      const name = interaction.options.getString("name");

      const channel = await guild.channels.create({
        name: `🔒 ${name}`,
        type: ChannelType.GuildVoice,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          {
            id: member.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.Connect,
              PermissionsBitField.Flags.Speak,
            ],
          },
        ],
      });

      privateVCs.set(channel.id, member.id);
      return interaction.reply({ content: `Private VC created: **${channel.name}**`, ephemeral: true });
    }

    if (interaction.commandName === "givekey") {
      const user = interaction.options.getUser("user");
      const channel = member.voice.channel;

      if (!channel || !privateVCs.has(channel.id))
        return interaction.reply({ content: "You must be inside your private VC.", ephemeral: true });

      if (privateVCs.get(channel.id) !== member.id)
        return interaction.reply({ content: "Only the VC owner can give keys.", ephemeral: true });

      await channel.permissionOverwrites.edit(user.id, {
        ViewChannel: true,
        Connect: true,
        Speak: true,
      });

      return interaction.reply({ content: `✅ Key given to **${user.username}**`, ephemeral: true });
    }

    if (interaction.commandName === "removekey") {
      const user = interaction.options.getUser("user");
      const channel = member.voice.channel;

      if (!channel || !privateVCs.has(channel.id))
        return interaction.reply({ content: "You must be inside your private VC.", ephemeral: true });

      if (privateVCs.get(channel.id) !== member.id)
        return interaction.reply({ content: "Only the VC owner can remove keys.", ephemeral: true });

      await channel.permissionOverwrites.delete(user.id).catch(() => {});
      return interaction.reply({ content: `✅ Key removed from **${user.username}**`, ephemeral: true });
    }

    if (interaction.commandName === "kickfromvc") {
      const user = interaction.options.getUser("user");
      const channel = member.voice.channel;

      if (!channel || !privateVCs.has(channel.id))
        return interaction.reply({ content: "You must be inside your private VC.", ephemeral: true });

      if (privateVCs.get(channel.id) !== member.id)
        return interaction.reply({ content: "Only the VC owner can kick users.", ephemeral: true });

      const targetMember = await guild.members.fetch(user.id).catch(() => null);
      if (!targetMember || targetMember.voice.channelId !== channel.id)
        return interaction.reply({ content: "That user is not in your VC.", ephemeral: true });

      // Revoke key + disconnect
      await channel.permissionOverwrites.delete(user.id).catch(() => {});
      await targetMember.voice.disconnect().catch(() => {});

      return interaction.reply({ content: `🚫 **${user.username}** was kicked and their key was revoked.`, ephemeral: true });
    }

    // ===== TRIAL QUIZ COMMAND =====
    if (interaction.commandName === "trialquiz") {
      // Must have Trial role
      if (!member.roles.cache.has(TRIAL_ROLE_ID)) {
        return interaction.reply({ content: "Only Trial Moderators can take this quiz.", ephemeral: true });
      }

      const row = await dbGet(`SELECT * FROM trial_mod WHERE user_id = ?`, [member.id]);

      if (!row) {
        return interaction.reply({ content: "I don’t have your Trial start date yet. Ask a Lead to re-apply the Trial role.", ephemeral: true });
      }

      const elapsed = Date.now() - row.start_ts;
      if (elapsed < TWO_WEEKS_MS) {
        const remaining = TWO_WEEKS_MS - elapsed;
        const hours = Math.ceil(remaining / (60 * 60 * 1000));
        return interaction.reply({ content: `You can take the quiz after **14 days** as Trial Mod.\nTime remaining: ~**${hours}h**`, ephemeral: true });
      }

      // Cooldown after fail
      if (row.last_attempt_ts && row.last_score !== null && row.last_score < 4) {
        const since = Date.now() - row.last_attempt_ts;
        if (since < FAIL_COOLDOWN_MS) {
          const remaining = FAIL_COOLDOWN_MS - since;
          const hours = Math.ceil(remaining / (60 * 60 * 1000));
          return interaction.reply({ content: `You’re on cooldown after your last attempt.\nTry again in ~**${hours}h**.`, ephemeral: true });
        }
      }

      // Start a new session
      const questions = pickQuizQuestions();
      quizSessions.set(member.id, {
        questions,
        index: 0,
        score: 0,
        guildId: guild.id,
        startedTs: Date.now(),
      });

      // expire session after 10 minutes
      setTimeout(() => quizSessions.delete(member.id), 10 * 60 * 1000);

      const first = questions[0];
      const menuRow = buildQuestionMenu(member.id, first, 0, questions.length);

      await logQuiz(guild, `📝 **Trial Quiz START** — <@${member.id}> started the quiz.`);

      return interaction.reply({
        content: `**Trial Moderator Quiz**\n\n**Q1:** ${first.q}`,
        components: [menuRow],
        ephemeral: true,
      });
    }
  } catch (err) {
    console.error("interactionCreate error:", err);
    try {
      if (interaction?.isRepliable?.()) {
        await interaction.reply({ content: "Something went wrong. Try again or contact leadership.", ephemeral: true });
      }
    } catch {}
  }
});

// =====================
// AUTO DELETE PRIVATE VC WHEN EMPTY
// =====================
client.on("voiceStateUpdate", async (oldState) => {
  const channel = oldState.channel;
  if (!channel) return;

  if (privateVCs.has(channel.id)) {
    if (channel.members.size === 0) {
      privateVCs.delete(channel.id);
      await channel.delete().catch(() => {});
    }
  }
});

// =====================
client.login(TOKEN);
