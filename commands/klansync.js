// Synchronizuje lokalna liste klanu z czlonkami posiadajacymi role LEGION.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { loadData, saveData } = require('../klan/clanStore');
const { config } = require('../src/config');

const ROLE_ID = config.clan.roleId;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('klansync')
    .setDescription('Synchronizuje wszystkich członków klanu DEVS')
    .setDefaultMemberPermissions(PermissionFlagsBits.Moderator),

  async execute(interaction) {
    await interaction.reply({ content: '🔄 Synchronizacja klanu…', ephemeral: true });

    const guild = interaction.guild;
    const role = await guild.roles.fetch(ROLE_ID);
    if (!role) {
      return interaction.editReply('❌ Nie znaleziono roli DEVS');
    }

    let fetched = 0;

    try {
      // ⬇️ PEŁNY FETCH GILDII (JEDYNY SPOSÓB)
      await guild.members.fetch({ force: true });
      fetched = guild.members.cache.size;
    } catch (err) {
      console.error('Błąd fetch memberów:', err);
      return interaction.editReply('❌ Timeout Discorda – spróbuj ponownie później.');
    }

    const data = loadData();
    const existingIds = new Set(data.members.map(m => m.id));

    role.members.forEach(member => {
      if (!existingIds.has(member.id)) {
        data.members.push({
          id: member.id,
          username: member.user.username,
          tag: member.user.tag,
          addedAt: new Date().toISOString()
        });
      }
    });

    data.roleId = ROLE_ID;
    saveData(data);

    await interaction.editReply(
      `✅ Synchronizacja zakończona\n` +
      `👥 Pobranо memberów: ${fetched}\n` +
      `🔥 Członków DEVS: ${role.members.size}`
    );
  }
};
