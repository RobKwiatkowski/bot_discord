// Reczne dodanie wplaty, gdy automatyczny listener Tipply nie zlapal zdarzenia.
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { config } = require('../src/config');
const { saveTipToWordpress } = require('../src/tipplyWordpress');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tipmanual')
    .setDescription('Dodaj ręcznie wpłatę z Tipply')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(option =>
      option
        .setName('nick')
        .setDescription('Nick wspierającego')
        .setRequired(true)
        .setMaxLength(191)
    )
    .addNumberOption(option =>
      option
        .setName('kwota')
        .setDescription('Kwota wpłaty')
        .setRequired(true)
        .setMinValue(0.01)
    )
    .addStringOption(option =>
      option
        .setName('wiadomosc')
        .setDescription('Wiadomość od wspierającego')
        .setRequired(false)
        .setMaxLength(1024)
    ),

  async execute(interaction) {
    const moderatorRoleId = config.discord.moderatorRoleId;

    if (!interaction.member.roles.cache.has(moderatorRoleId)) {
      return interaction.reply({
        content: '❌ Nie masz uprawnień do użycia tej komendy.',
        ephemeral: true
      });
    }

    const nickname = interaction.options.getString('nick').trim();
    const amount = interaction.options.getNumber('kwota');
    const submittedMessage = interaction.options.getString('wiadomosc') || '';
    const displayMessage = submittedMessage || 'Brak wiadomości';

    let color = '#2ecc71';
    if (amount >= 100) color = '#f1c40f';
    else if (amount >= 50) color = '#9b59b6';
    else if (amount >= 10) color = '#3498db';

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle('💰 Nowa wpłata!')
      .addFields(
        { name: '👤 Wspierający', value: nickname, inline: true },
        { name: '💵 Kwota', value: `${amount.toFixed(2)} PLN`, inline: true },
        { name: '💬 Wiadomość', value: displayMessage }
      )
      .setFooter({
        text: 'Ty też możesz zostać naszym sponsorem! | tipply.pl/@polishpubglegion'
      })
      .setTimestamp();

    await interaction.channel.send({ embeds: [embed] });

    try {
      const result = await saveTipToWordpress({
        nickname,
        amount,
        message: submittedMessage,
        externalId: `manual:${interaction.id}`,
        donatedAt: new Date(interaction.createdTimestamp).toISOString()
      });

      if (!result.saved) {
        throw new Error('brak WP_TIP_ENDPOINT');
      }

      await interaction.reply({
        content: '✅ Ręczna wpłata została dodana na Discordzie i stronie.',
        ephemeral: true
      });
    } catch (error) {
      console.error('[tipmanual] Nie udalo sie zapisac wplaty w WordPress:', error.message);
      await interaction.reply({
        content: '⚠️ Wpłata została dodana na Discordzie, ale zapis na stronie się nie udał. Sprawdź logi bota.',
        ephemeral: true
      });
    }
  }
};
