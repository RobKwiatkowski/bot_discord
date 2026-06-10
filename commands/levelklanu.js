// Reczna komenda do odswiezenia poziomu klanu na stronie WordPress.
const { SlashCommandBuilder } = require('discord.js');
const updateWordpressKlanLvl = require('../utils/updateWordpressKlanLvl');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('levelklanu')
    .setDescription('Recznie aktualizuje poziom klanu Legion na stronie'),

  async execute(interaction) {
    console.log('[levelklanu] START');

    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await updateWordpressKlanLvl();

      console.log(
        `[levelklanu] OK | clan=${result.clanName || 'unknown'} | ` +
        `level=${result.newLevel}`
      );

      await interaction.editReply(
        `OK - strona zaktualizowana. Aktualny poziom klanu: ${result.newLevel}.`
      );
    } catch (err) {
      console.error('[levelklanu] Blad:', err.response?.data || err.message);
      await interaction.editReply(
        `BLAD - nie udalo sie zaktualizowac strony: ${err.message}`
      );
    }
  }
};
