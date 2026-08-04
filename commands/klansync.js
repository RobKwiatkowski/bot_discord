// Synchronizuje lokalna liste klanu z czlonkami posiadajacymi role LEGION.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { loadData, saveData, upsertDiscordMember } = require('../klan/clanStore');
const { config } = require('../src/config');

const ROLE_ID = config.clan.roleId;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('klansync')
    .setDescription('Synchronizuje wszystkich czlonkow klanu Legion')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    await interaction.reply({ content: 'Synchronizacja klanu...', ephemeral: true });

    const guild = interaction.guild;
    const role = await guild.roles.fetch(ROLE_ID);
    if (!role) {
      return interaction.editReply('Nie znaleziono roli Legion.');
    }

    let fetched = 0;

    try {
      await guild.members.fetch({ force: true });
      fetched = guild.members.cache.size;
    } catch (err) {
      console.error('Blad fetch memberow:', err);
      return interaction.editReply('Timeout Discorda - sprobuj ponownie pozniej.');
    }

    role.members.forEach(member => {
      upsertDiscordMember(member);
    });

    const data = loadData();
    data.roleId = ROLE_ID;
    saveData(data);

    await interaction.editReply(
      `Synchronizacja zakonczona\n` +
      `Pobrano memberow: ${fetched}\n` +
      `Czlonkow z rola Legion: ${role.members.size}\n` +
      `Osoby reczne zostaly zachowane.`
    );
  }
};
