const { 
  Client, 
  GatewayIntentBits, 
  PermissionsBitField,
  ChannelType,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const TOKEN = process.env.TOKEN;

/* ===========================
   TIER ROLE IDS
=========================== */

const T4 = "1471641147314274354";
const T3 = "1471641311227678832";
const T2 = "1471643483256262737";
const T1 = "1471643527640387656";

const tierRoles = [T4, T3, T2, T1];

/* ===========================
   UPDATED STAFF STRUCTURE
=========================== */

const staffRoles = {

  // 🔴 TOP
  T4: [
    "Executive",
    "Head Of Operations",
    "Board Of Directors (BOD)"
  ],

  // 🟣 UPPER LEADERSHIP
  T3: [
    "Team Director",
    "Lead",
    "Staff Lead",
    "GFX Lead",
    "Content Lead"
  ],

  // 🟡 MANAGEMENT / ADMIN
  T2: [
    "Admin",
    "Admin Apprentice",
    "Manager",
    "Manager Apprentice",
    "Sr. Mod"
  ],

  // 🟢 MODERATION
  T1: [
    "Moderator",
    "Trial Moderator"
  ]
};

/* ===========================
   PRIVATE VC SYSTEM
=========================== */

const execRoles = staffRoles.T4;
const privateVCs = new Map();

/* ===========================
   READY + REGISTER SLASH COMMANDS
=========================== */

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName('createvc')
      .setDescription('Create a private VC')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('VC Name')
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('givekey')
      .setDescription('Give VC access to a user')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to give access')
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('removekey')
      .setDescription('Remove VC access from a user')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to remove')
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('kickfromvc')
      .setDescription('Kick a user and remove their key')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('User to kick')
          .setRequired(true)
      )
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands }
  );

  console.log("Slash commands registered.");
});

/* ===========================
   TIER AUTO SYNC (NO LOOP)
=========================== */

client.on("guildMemberUpdate", async (oldMember, newMember) => {

  const changedRoles = [
    ...newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id)).values(),
    ...oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id)).values()
  ];

  const onlyTierChange = changedRoles.every(r => tierRoles.includes(r.id));
  if (onlyTierChange) return;

  const hasRole = (names) =>
    names.some(name =>
      newMember.roles.cache.some(role => role.name === name)
    );

  let correctTier = null;

  if (hasRole(staffRoles.T4)) correctTier = T4;
  else if (hasRole(staffRoles.T3)) correctTier = T3;
  else if (hasRole(staffRoles.T2)) correctTier = T2;
  else if (hasRole(staffRoles.T1)) correctTier = T1;

  const currentTier = tierRoles.find(id =>
    newMember.roles.cache.has(id)
  );

  if (currentTier === correctTier) return;

  try {
    if (currentTier) {
      await newMember.roles.remove(currentTier);
    }

    if (correctTier) {
      await newMember.roles.add(correctTier);
    }

  } catch (err) {
    console.error("Tier sync error:", err);
  }
});

/* ===========================
   PRIVATE VC COMMAND HANDLER
=========================== */

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;
  const guild = interaction.guild;

  const hasExecRole = execRoles.some(role =>
    member.roles.cache.some(r => r.name === role)
  );

  // CREATE VC
  if (interaction.commandName === 'createvc') {

    if (!hasExecRole) {
      return interaction.reply({ content: "You must be Executive+ to create private VCs.", ephemeral: true });
    }

    const name = interaction.options.getString('name');

    const channel = await guild.channels.create({
      name: `🔒 ${name}`,
      type: ChannelType.GuildVoice,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionsBitField.Flags.ViewChannel]
        },
        {
          id: member.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.Speak
          ]
        }
      ]
    });

    privateVCs.set(channel.id, member.id);

    return interaction.reply({ content: `Private VC created: ${channel.name}`, ephemeral: true });
  }

  // GIVE KEY
  if (interaction.commandName === 'givekey') {

    const user = interaction.options.getUser('user');
    const channel = member.voice.channel;

    if (!channel || !privateVCs.has(channel.id))
      return interaction.reply({ content: "You must be inside your private VC.", ephemeral: true });

    if (privateVCs.get(channel.id) !== member.id)
      return interaction.reply({ content: "Only the VC owner can give keys.", ephemeral: true });

    await channel.permissionOverwrites.edit(user.id, {
      ViewChannel: true,
      Connect: true,
      Speak: true
    });

    return interaction.reply({ content: `Key given to ${user.username}`, ephemeral: true });
  }

  // REMOVE KEY
  if (interaction.commandName === 'removekey') {

    const user = interaction.options.getUser('user');
    const channel = member.voice.channel;

    if (!channel || !privateVCs.has(channel.id))
      return interaction.reply({ content: "You must be inside your private VC.", ephemeral: true });

    if (privateVCs.get(channel.id) !== member.id)
      return interaction.reply({ content: "Only the VC owner can remove keys.", ephemeral: true });

    await channel.permissionOverwrites.delete(user.id);

    return interaction.reply({ content: `Key removed from ${user.username}`, ephemeral: true });
  }

  // KICK + REMOVE KEY
  if (interaction.commandName === 'kickfromvc') {

    const user = interaction.options.getUser('user');
    const channel = member.voice.channel;

    if (!channel || !privateVCs.has(channel.id))
      return interaction.reply({ content: "You must be inside your private VC.", ephemeral: true });

    if (privateVCs.get(channel.id) !== member.id)
      return interaction.reply({ content: "Only the VC owner can kick users.", ephemeral: true });

    const targetMember = guild.members.cache.get(user.id);

    if (!targetMember || targetMember.voice.channelId !== channel.id)
      return interaction.reply({ content: "That user is not in your VC.", ephemeral: true });

    await channel.permissionOverwrites.delete(user.id);
    await targetMember.voice.disconnect();

    return interaction.reply({ content: `${user.username} has been removed and their key revoked.`, ephemeral: true });
  }

});

/* ===========================
   AUTO DELETE EMPTY PRIVATE VC
=========================== */

client.on('voiceStateUpdate', async (oldState) => {

  const channel = oldState.channel;

  if (channel && privateVCs.has(channel.id)) {
    if (channel.members.size === 0) {
      privateVCs.delete(channel.id);
      await channel.delete().catch(() => {});
    }
  }

});

client.login(TOKEN);
