const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

const T4 = "1471641147314274354";
const T3 = "1471641311227678832";
const T2 = "1471643483256262737";
const T1 = "1471643527640387656";

const tierRoles = [T4, T3, T2, T1];

const roles = {
  T4: ["Executive", "Head Of Operations", "Board Of Directors (BOD)"],
  T3: ["Admin", "Admin Apprentice"],
  T2: ["Sr. Mod", "Manager", "Manager Apprentice", "Lead", "Staff Lead", "GFX Lead", "Content Lead", "Team Director"],
  T1: ["Moderator", "Trial Moderator"]
};

client.on("guildMemberUpdate", async (oldMember, newMember) => {

  // Ignore if role change was ONLY tier roles
  const oldRoles = oldMember.roles.cache;
  const newRoles = newMember.roles.cache;

  const changedRoles = newRoles.filter(role => !oldRoles.has(role.id))
    .concat(oldRoles.filter(role => !newRoles.has(role.id)));

  const onlyTierChange = changedRoles.every(role => tierRoles.includes(role.id));
  if (onlyTierChange) return;

  try {
    const hasRole = (names) =>
      names.some(name =>
        newMember.roles.cache.some(role => role.name === name)
      );

    let correctTier = null;

    if (hasRole(roles.T4)) correctTier = T4;
    else if (hasRole(roles.T3)) correctTier = T3;
    else if (hasRole(roles.T2)) correctTier = T2;
    else if (hasRole(roles.T1)) correctTier = T1;

    const currentTier = tierRoles.find(id =>
      newMember.roles.cache.has(id)
    );

    if (currentTier === correctTier) return;

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

client.login(process.env.TOKEN);
