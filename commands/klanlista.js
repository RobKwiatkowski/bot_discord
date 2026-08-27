// Wyswietla embed z aktualna lokalna lista czlonkow klanu DEVS.
const { AttachmentBuilder, SlashCommandBuilder } = require('discord.js');
const { createClanCard } = require('../klan/clanCard');
const { createClanEmbed } = require('../klan/clanEmbed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('klanlista')
    .setDescription('Wyświetla listę członków klanu DEVS'),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const buffer = await createClanCard({ guild: interaction.guild });
      const attachment = new AttachmentBuilder(buffer, { name: 'klan-legion.png' });
      await interaction.editReply({ files: [attachment] });
    } catch (err) {
      console.error('Błąd /klanlista:', err);
      const embed = createClanEmbed();
      await interaction.editReply({ embeds: [embed] });
    }
  }
};
