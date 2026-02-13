const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  PermissionsBitField,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const Database = require("better-sqlite3");

/* ================= ENV ================= */
const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID; // recommended
const MOD_ROLE_ID = process.env.MOD_ROLE_ID; // optional now (we can create roles), but keep if you use it elsewhere
const TRIAL_ROLE_ID = process.env.TRIAL_ROLE_ID; // optional now

if (!TOKEN) throw new Error("Missing TOKEN");

/* ================= CLIENT ================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
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

function dbGet(sql, params = []) {
  return db.prepare(sql).get(...params);
}
function dbRun(sql, params = []) {
  return db.prepare(sql).run(...params);
}

/* ================= TIER ROLE IDS (YOUR EXISTING) ================= */
const T4_ID = "1471641147314274354";
const T3_ID = "1471641311227678832";
const T2_ID = "1471643483256262737";
const T1_ID = "1471643527640387656";
const tierRoleIds = [T4_ID, T3_ID, T2_ID, T1_ID];

/* ================= STRUCTURE A CONFIG =================
   Display roles = NO perms (cosmetic)
   Tier roles = ALL perms
====================================================== */

const ROLE_SPEC = {
  // ---- Tiers (permissions) ----
  tiers: [
    {
      name: "T4",
      idHint: T4_ID,
      color: "#1E1B4B",
      hoist: true,
      mentionable: false,
      perms: [
        // High command (be careful)
        "Administrator",
      ],
    },
    {
      name: "T3",
      idHint: T3_ID,
      color: "#1E3A8A",
      hoist: true,
      mentionable: false,
      perms: [
        "ViewAuditLog",
        "ManageGuild",
        "ManageRoles",
        "ManageChannels",
        "KickMembers",
        "BanMembers",
        "ModerateMembers",
        "ManageMessages",
        "ManageThreads",
        "MoveMembers",
        "MuteMembers",
        "DeafenMembers",
        "MentionEveryone",
        "ManageNicknames",
        "ManageWebhooks",
        "ManageEvents",
      ],
    },
    {
      name: "T2",
      idHint: T2_ID,
      color: "#14532D",
      hoist: true,
      mentionable: false,
      perms: [
        "ViewAuditLog",
        "ManageMessages",
        "ManageThreads",
        "ModerateMembers",
        "KickMembers",
        "MoveMembers",
        "MuteMembers",
        "DeafenMembers",
        "ManageNicknames",
      ],
    },
    {
      name: "T1",
      idHint: T1_ID,
      color: "#1F2937",
      hoist: true,
      mentionable: false,
      perms: [
        "ManageMessages",
        "ManageThreads",
        "ModerateMembers",
        "MoveMembers",
        "MuteMembers",
        "DeafenMembers",
      ],
    },
  ],

  // ---- Display staff roles (cosmetic, NO perms) ----
  display: [
    { name: "Board Of Directors (BOD)", color: "#6D28D9" },
    { name: "Head Of Operations", color: "#4338CA" },
    { name: "Executive", color: "#5B21B6" },

    { name: "Team Director", color: "#1E40AF" },

    // “Lead” bucket + specific lead display roles
    { name: "Lead", color: "#2563EB" },
    { name: "Staff Lead", color: "#2563EB" },
    { name: "GFX Lead", color: "#0EA5E9" },
    { name: "Content Lead", color: "#0284C7" },

    { name: "Manager", color: "#D97706" },
    { name: "Manager Apprentice", color: "#F59E0B" },

    { name: "Admin", color: "#B91C1C" },
    { name: "Admin Apprentice", color: "#EF4444" },

    { name: "Sr. Mod", color: "#15803D" },
    { name: "Moderator", color: "#22C55E" },
    { name: "Trial Moderator", color: "#4ADE80" },
    { name: "Apprentice Mod", color: "#86EFAC" },
  ],
};

// Tier mapping (your latest request)
const staffRoleNames = {
  T4: ["Executive", "Head Of Operations", "Board Of Directors (BOD)"],
  T3: ["Team Director", "Lead", "Staff Lead", "GFX Lead", "Content Lead"],
  T2: ["Admin", "Admin Apprentice", "Manager", "Manager Apprentice", "Sr. Mod"],
  T1: ["Moderator", "Trial Moderator", "Apprentice Mod"],
};

/* ================= QUIZ SYSTEM (unchanged logic, stable) ================= */
const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;
const COOLDOWN = 24 * 60 * 60 * 1000;

const QUESTIONS = [
  { q: "What should you do first when a rule is broken?", a: ["Ignore", "Handle calmly", "Argue"], c: 1 },
  { q: "When should you escalate?", a: ["Serious violation", "Small typo", "Never"], c: 0 },
  { q: "How should staff act in conflicts?", a: ["Stay calm", "Take sides", "React emotionally"], c: 0 },
  { q: "Unsure about punishment?", a: ["Ask higher staff", "Guess", "Ignore"], c: 0 },
  { q: "What represents good staff behavior?", a: ["Professionalism", "Ego", "Power abuse"], c: 0 },
];

const sessions = new Map();

/* ================= UTILS ================= */
function hexToInt(hex) {
  return parseInt(hex.replace("#", ""), 16);
}

async function ensureRole(guild, spec, { perms = null, hoist = false, mentionable = false } = {}) {
  let role =
    guild.roles.cache.find((r) => r.name === spec.name) ||
    (spec.idHint ? guild.roles.cache.get(spec.idHint) : null);

  const payload = {
    name: spec.name,
    color: hexToInt(spec.color),
    hoist: hoist ?? false,
    mentionable: mentionable ?? false,
  };

  // Create if missing
  if (!role) {
    role = await guild.roles.create({ name: payload.name, color: payload.color, hoist: payload.hoist, mentionable: payload.mentionable });
  } else {
    // Update basic appearance
    await role.edit(payload).catch(() => {});
  }

  // Update perms if provided
  if (perms) {
    const bitfield = new PermissionsBitField(perms.map((p) => PermissionsBitField.Flags[p]));
    await role.setPermissions(bitfield).catch(() => {});
  }

  return role;
}

function isManagedOrEveryone(role) {
  return role.managed || role.id === role.guild.id;
}

function canBotManageRole(guild, role) {
  const me = guild.members.me;
  if (!me) return false;
  const botTop = me.roles.highest;
  return botTop.position > role.position;
}

async function positionRolesUnderBot(guild, rolesInOrderTopToBottom) {
  // We can only set positions for roles below the bot’s top role.
  const me = guild.members.me;
  if (!me) return;

  const botTopPos = me.roles.highest.position;
  let pos = botTopPos - 1;

  for (const role of rolesInOrderTopToBottom) {
    if (!role) continue;
    if (role.managed) continue;
    if (!canBotManageRole(guild, role)) continue;

    // Don’t push past bottom
    if (pos <= 1) break;

    await role.setPosition(pos).catch(() => {});
    pos -= 1;
  }
}

/* ================= READY / COMMANDS ================= */
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder().setName("trialquiz").setDescription("Take Trial Moderator promotion quiz (after 14 days)"),

    new SlashCommandBuilder().setName("setuproles").setDescription("Enterprise: Create/Update staff display roles + T1–T4 (Structure A)"),

    new SlashCommandBuilder().setName("cleanuproles").setDescription("DANGER: Delete non-essential roles (below bot) after confirmation"),

  ].map((c) => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log("Slash commands registered (guild).");
  } else {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("Slash commands registered (global).");
  }
});

/* ================= TIER AUTO SYNC + TRIAL TRACK ================= */
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    // Track trial role start time persistently
    const trialRole = newMember.roles.cache.find(r => r.name === "Trial Moderator");
    const hadTrial = oldMember.roles.cache.some(r => r.name === "Trial Moderator");
    const hasTrial = newMember.roles.cache.some(r => r.name === "Trial Moderator");

    if (!hadTrial && hasTrial) {
      dbRun(`INSERT OR REPLACE INTO trial_mod (user_id, start_ts) VALUES (?, ?)`, [newMember.id, Date.now()]);
    }
    if (hadTrial && !hasTrial) {
      dbRun(`DELETE FROM trial_mod WHERE user_id = ?`, [newMember.id]);
    }

    // No-loop guard for tier-only changes
    const added = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    const removed = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
    const changed = [...added.values(), ...removed.values()];
    if (changed.length && changed.every(r => tierRoleIds.includes(r.id))) return;

    const hasRoleName = (names) => names.some(n => newMember.roles.cache.some(r => r
