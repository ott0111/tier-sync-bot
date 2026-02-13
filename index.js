const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  PermissionsBitField,
  ChannelType
} = require("discord.js");

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN) throw new Error("Missing TOKEN");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ]
});

/* ================= TIER IDS ================= */

const T4 = "1471641147314274354";
const T3 = "1471641311227678832";
const T2 = "1471643483256262737";
const T1 = "1471643527640387656";

const tierRoleIds = [T4, T3, T2, T1];

const staffRoles = {
  T4: ["Executive", "Head Of Operations", "Board Of Directors (BOD)"],
  T3: ["Team Director", "Lead", "Staff Lead", "GFX Lead", "Content Lead"],
  T2: ["Admin", "Admin Apprentice", "Manager", "Manager Apprentice", "Sr. Mod"],
  T1: ["Moderator", "Trial Moderator", "Apprentice Mod"]
};

/* ================= TIER AUTO SYNC ================= */

client.on("guildMemberUpdate", async (oldMember, newMember) => {

  try {

    const added = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    const removed = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
    const changed = [...added.values(), ...removed.values()];

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

    if (currentTier)
      await newMember.roles.remove(currentTier).catch(() => {});

    if (correctTier)
      await newMember.roles.add(correctTier).catch(() => {});

  } catch (err) {
    console.error("Tier sync error:", err);
  }

});

/* ================= PRIVATE VC SYSTEM ================= */

const privateVCs = new Map();

/* ================= READY ================= */

client.once("ready", async () => {

  console.log(`Logged in as ${client.user.tag}`);

  const commands = [

    new SlashCommandBuilder()
      .setName("setuproles")
      .setDescription("Create/update staff roles & T1-T4"),

    new SlashCommandBuilder()
      .setName("createvc")
      .setDescription("Create private VC (Executive+)"),

    new SlashCommandBuilder()
      .setName("givekey")
      .setDescription("Give VC access")
      .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),

    new SlashCommandBuilder()
      .setName("removekey")
      .setDescription("Remove VC access")
      .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),

    new SlashCommandBuilder()
      .setName("kickfromvc")
      .setDescription("Kick user from VC")
      .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))

  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  if (GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, GUILD_ID),
      { body: commands }
    );
  }

  console.log("Commands registered.");

});

/* ================= COMMAND HANDLER ================= */

client.on("interactionCreate", async interaction => {

  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;
  const guild = interaction.guild;

  /* ===== SETUP ROLES ===== */

  if (interaction.commandName === "setuproles") {

    if (!member.permissions.has(PermissionsBitField.Flags.Administrator))
      return interaction.reply({ content: "Admin only.", ephemeral: true });

    await interaction.reply({ content: "Setting up roles...", ephemeral: true });

    const createRole = async (name, perms = []) => {

      let role = guild.roles.cache.find(r => r.name === name);

      if (!role) {
        role = await guild.roles.create({ name });
      }

      if (perms.length) {
        const bitfield = new PermissionsBitField(
          perms.map(p => PermissionsBitField.Flags[p])
        );
        await role.setPermissions(bitfield);
      } else {
        await role.setPermissions([]);
      }

      return role;
    };

    // Tiers
    await createRole("T4", ["Administrator"]);
    await createRole("T3", ["ManageRoles", "ManageMessages", "ModerateMembers"]);
    await createRole("T2", ["ManageMessages", "ModerateMembers"]);
    await createRole("T1", ["ModerateMembers"]);

    // Display roles (no perms)
    const displayRoles = [
      ...staffRoles.T4,
      ...staffRoles.T3,
      ...staffRoles.T2,
      ...staffRoles.T1
    ];

    for (const name of displayRoles) {
      await createRole(name, []);
    }

    return interaction.followUp({ content: "Roles setup complete.", ephemeral: true });
  }

  /* ===== CREATE VC ===== */

  if (interaction.commandName === "createvc") {

    const isExec = staffRoles.T4.some(r =>
      member.roles.cache.some(role => role.name === r)
    );

    if (!isExec)
      return interaction.reply({ content: "Executive+ only.", ephemeral: true });

    const channel = await guild.channels.create({
      name: `🔒 Private VC`,
      type: ChannelType.GuildVoice,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionsBitField.Flags.Connect]
        },
        {
          id: member.id,
          allow: [
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.Speak
          ]
        }
      ]
    });

    privateVCs.set(channel.id, member.id);

    return interaction.reply({ content: "Private VC created.", ephemeral: true });
  }

  /* ===== GIVE KEY ===== */

  if (interaction.commandName === "givekey") {

    const channel = member.voice.channel;
    if (!channel || !privateVCs.has(channel.id))
      return interaction.reply({ content: "You must be in your private VC.", ephemeral: true });

    if (privateVCs.get(channel.id) !== member.id)
      return interaction.reply({ content: "Only VC owner can give access.", ephemeral: true });

    const user = interaction.options.getUser("user");

    await channel.permissionOverwrites.edit(user.id, {
      Connect: true,
      ViewChannel: true,
      Speak: true
    });

    return interaction.reply({ content: "Access granted.", ephemeral: true });
  }

  /* ===== REMOVE KEY ===== */

  if (interaction.commandName === "removekey") {

    const channel = member.voice.channel;
    if (!channel || !privateVCs.has(channel.id))
      return interaction.reply({ content: "You must be in your private VC.", ephemeral: true });

    if (privateVCs.get(channel.id) !== member.id)
      return interaction.reply({ content: "Only VC owner can remove access.", ephemeral: true });

    const user = interaction.options.getUser("user");

    await channel.permissionOverwrites.delete(user.id);

    return interaction.reply({ content: "Access removed.", ephemeral: true });
  }

  /* ===== KICK FROM VC ===== */

  if (interaction.commandName === "kickfromvc") {

    const channel = member.voice.channel;
    if (!channel || !privateVCs.has(channel.id))
      return interaction.reply({ content: "You must be in your private VC.", ephemeral: true });

    if (privateVCs.get(channel.id) !== member.id)
      return interaction.reply({ content: "Only VC owner can kick.", ephemeral: true });

    const user = interaction.options.getUser("user");
    const target = await guild.members.fetch(user.id);

    if (target.voice.channelId === channel.id)
      await target.voice.disconnect().catch(() => {});

    await channel.permissionOverwrites.delete(user.id);

    return interaction.reply({ content: "User removed from VC.", ephemeral: true });
  }

});

/* ================= AUTO DELETE EMPTY VC ================= */

client.on("voiceStateUpdate", async (oldState) => {

  const channel = oldState.channel;

  if (channel && privateVCs.has(channel.id)) {
    if (channel.members.size === 0) {
      privateVCs.delete(channel.id);
      await channel.delete().catch(() => {});
    }
  }

});

client.login(TOKEN);
