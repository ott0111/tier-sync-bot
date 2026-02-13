const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// 🔥 TIER ROLE IDS
const T4 = "1471641147314274354";
const T3 = "1471641311227678832";
const T2 = "1471643483256262737";
const T1 = "1471643527640387656";

const roles = {
  T4: ["Executive", "Head Of Operations", "Board Of Directors (BOD)"],
  T3: ["Admin", "Admin Apprentice"],
  T2: ["Sr. Mod", "Manager", "Manager Apprentice", "Lead", "Staff Lead", "GFX Lead", "Content Lead", "Team Director"],
  T1: ["Moderator", "Trial Moderator"]
};

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  const member = newMember;

  try {
    const hasRole = (names) =>
      names.some(name =>
        member.roles.cache.some(role => role.name === name)
      );

    await member.roles.remove([T4, T3, T2, T1]).catch(() => {});

    if (hasRole(roles.T4)) {
      await member.roles.add(T4);
    } else if (hasRole(roles.T3)) {
      await member.roles.add(T3);
    } else if (hasRole(roles.T2)) {
      await member.roles.add(T2);
    } else if (hasRole(roles.T1)) {
      await member.roles.add(T1);
    }

  } catch (err) {
    console.error(err);
  }
});

client.login(process.env.TOKEN);
