// Rebuilds the administration list from Discord roles and sends it to WordPress.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { syncAdministrationFromGuild } = require('../administracja/adminStore');
const { syncAdministrationToWP } = require('../administracja/wpSync');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('administracjasync')
    .setDescription('Synchronizuje administracje z WordPressem')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    await interaction.reply({
      content: 'Synchronizuje administracje...',
      ephemeral: true
    });

    try {
      const result = await syncAdministrationFromGuild(interaction.guild);
      const wpResult = await syncAdministrationToWP();

      await interaction.editReply(
        `OK. Pobrano memberow: ${result.fetched}\n` +
        `Administracja: ${result.count}\n` +
        `WordPress: ${wpResult.count ?? 'OK'}`
      );
    } catch (err) {
      console.error('administracjasync error:', err);
      await interaction.editReply('Blad synchronizacji administracji z WordPressem.');
    }
  }
};
