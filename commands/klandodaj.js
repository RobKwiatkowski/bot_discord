// Recznie dodaje gracza PUBG do listy klanu, bez powiazania z rola Discord.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { addManualMember } = require('../klan/clanStore');
const { syncClanToWP } = require('../klan/wpSync');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('klandodaj')
    .setDescription('Recznie dodaje gracza PUBG do listy klanu')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addStringOption(option =>
      option
        .setName('nick')
        .setDescription('Nick gracza PUBG')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('rola')
        .setDescription('Rola na liscie klanu')
        .setRequired(true)
        .addChoices(
          { name: 'Członek', value: 'Członek' },
          { name: 'Kierownik', value: 'Kierownik' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const nick = interaction.options.getString('nick');
    const roleClan = interaction.options.getString('rola');
    const result = addManualMember(nick, roleClan);

    if (!result.ok) {
      if (result.reason === 'discord_member') {
        await interaction.editReply(
          `Nie dodaje recznie ${result.member.username}, bo ta osoba jest zarzadzana przez role Discorda Legion.`
        );
        return;
      }

      await interaction.editReply('Podaj poprawny nick gracza PUBG.');
      return;
    }

    try {
      await syncClanToWP();
      await interaction.editReply(
        `${result.created ? 'Dodano' : 'Zaktualizowano'} ${result.member.username} jako ${result.member.roleClan} i wyslano liste do WP.`
      );
    } catch (err) {
      console.error('[klandodaj] Blad synchronizacji WP:', err);
      await interaction.editReply(
        `${result.created ? 'Dodano' : 'Zaktualizowano'} ${result.member.username}, ale nie udalo sie wyslac listy do WP.`
      );
    }
  }
};
