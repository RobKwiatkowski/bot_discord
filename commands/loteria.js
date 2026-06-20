// Slash command dla loterii: start, zapis uczestnika, losowanie i reset.
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { config } = require('../src/config');
const { readJson, writeJson } = require('../src/jsonStore');

function canManageMessages(interaction) {
  return interaction.member.permissions.has(PermissionFlagsBits.ManageMessages);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loteria')
    .setDescription('Zarzadzanie loteria')
    .addSubcommand(sub =>
      sub
        .setName('start')
        .setDescription('Publikuje wiadomosc startowa loterii')
    )
    .addSubcommand(sub =>
      sub
        .setName('dodaj')
        .setDescription('Dopisuje Cie do loterii')
        .addStringOption(option =>
          option
            .setName('nick')
            .setDescription('Nick do wyswietlenia na liscie')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('losuj')
        .setDescription('Losuje zwyciezce loterii')
    )
    .addSubcommand(sub =>
      sub
        .setName('reset')
        .setDescription('Czyści liste uczestnikow')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'start') {
      if (!canManageMessages(interaction)) {
        await interaction.reply({ content: 'Tylko moderator moze startowac loterie.', ephemeral: true });
        return;
      }
      await interaction.channel.send('Rusza loteria! Aby wziac udzial uzyj `/loteria dodaj`.');
      await interaction.reply({ content: 'Wiadomosc loterii opublikowana.', ephemeral: true });
      return;
    }

    if (sub === 'dodaj') {
      const participants = readJson(config.files.lottery, []);
      if (participants.find(user => user.id === interaction.user.id)) {
        await interaction.reply({ content: 'Juz bierzesz udzial w loterii.' });
        return;
      }

      participants.push({
        id: interaction.user.id,
        nick: interaction.options.getString('nick') || interaction.member.displayName
      });
      writeJson(config.files.lottery, participants);
      await interaction.reply({ content: 'Dodano Cie do loterii.' });
      return;
    }

    if (sub === 'losuj') {
      if (!canManageMessages(interaction)) {
        await interaction.reply({ content: 'Tylko moderator moze losowac.', ephemeral: true });
        return;
      }

      const participants = readJson(config.files.lottery, []);
      if (participants.length === 0) {
        await interaction.reply({ content: 'Lista uczestnikow jest pusta.', ephemeral: true });
        return;
      }

      const winner = participants[Math.floor(Math.random() * participants.length)];
      const embed = new EmbedBuilder()
        .setTitle('Wyniki loterii')
        .addFields(
          { name: 'Uczestnicy', value: participants.map(user => `<@${user.id}> (${user.nick})`).join('\n') },
          { name: 'Zwyciezca', value: `<@${winner.id}> (${winner.nick})` }
        )
        .setColor(0xFFD700)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'reset') {
      if (!canManageMessages(interaction)) {
        await interaction.reply({ content: 'Tylko moderator moze resetowac loterie.', ephemeral: true });
        return;
      }
      writeJson(config.files.lottery, []);
      await interaction.reply({ content: 'Lista uczestnikow zostala wyczyszczona.', ephemeral: true });
    }
  }
};
