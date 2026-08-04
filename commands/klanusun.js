// Recznie usuwa gracza PUBG dodanego poza Discordem.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { removeManualMember } = require('../klan/clanStore');
const { syncClanToWP } = require('../klan/wpSync');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('klanusun')
    .setDescription('Usuwa recznie dodanego gracza z listy klanu')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addStringOption(option =>
      option
        .setName('nick')
        .setDescription('Nick gracza PUBG')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const nick = interaction.options.getString('nick');
    const result = removeManualMember(nick);

    if (!result.ok) {
      if (result.reason === 'discord_member') {
        await interaction.editReply(
          `Nie moge usunac recznie ${result.member.username}, bo ta osoba pochodzi z Discorda. Zeby ja usunac, odbierz jej role Legion.`
        );
        return;
      }

      if (result.reason === 'not_found') {
        await interaction.editReply(`Nie znalazlem recznie dodanego gracza: ${nick}.`);
        return;
      }

      await interaction.editReply('Podaj poprawny nick gracza PUBG.');
      return;
    }

    try {
      await syncClanToWP();
      await interaction.editReply(`Usunieto ${result.member.username} i wyslano liste do WP.`);
    } catch (err) {
      console.error('[klanusun] Blad synchronizacji WP:', err);
      await interaction.editReply(
        `Usunieto ${result.member.username}, ale nie udalo sie wyslac listy do WP.`
      );
    }
  }
};
