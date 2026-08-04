// Krotka prezentacja oficjalnej strony Polish PUBG Legion.
const path = require('path');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const WEBSITE_URL = 'https://polishpubglegion.pl/';
const LOGO_FILE_NAME = 'polish-pubg-legion.png';

function buildWebsiteMessage() {
  const logoPath = path.join(__dirname, '..', 'assets', 'clan_logo.png');
  const logo = new AttachmentBuilder(logoPath, { name: LOGO_FILE_NAME });

  const embed = new EmbedBuilder()
    .setColor(0xe10600)
    .setAuthor({
      name: 'POLISH PUBG LEGION',
      iconURL: `attachment://${LOGO_FILE_NAME}`
    })
    .setTitle('Twoja ekipa. Twoje rozgrywki. Nasz Legion.')
    .setURL(WEBSITE_URL)
    .setDescription(
      'Polska społeczność graczy z **PUBG: Battlegrounds** w centrum. ' +
      'Znajdź ekipę do gry, poznaj ludzi i zostań częścią aktywnego Legionu.'
    )
    .addFields(
      {
        name: '🎯 Wspólna gra',
        value: 'DUO, SQUAD, treningi i rozgrywki społecznościowe.',
        inline: true
      },
      {
        name: '🏆 Coś więcej',
        value: 'Turnieje, eventy, konkursy, rankingi i autorski bot.',
        inline: true
      },
      {
        name: '🤝 Miejsce dla każdego',
        value: 'Dla weteranów, nowych graczy i fanów innych gier.',
        inline: false
      }
    )
    .setThumbnail(`attachment://${LOGO_FILE_NAME}`)
    .setFooter({ text: 'Polish PUBG Legion • Gramy razem' });

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Odwiedź naszą stronę')
      .setEmoji('🌐')
      .setStyle(ButtonStyle.Link)
      .setURL(WEBSITE_URL)
  );

  return {
    embeds: [embed],
    components: [buttons],
    files: [logo]
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('www')
    .setDescription('Pokazuje oficjalną stronę Polish PUBG Legion'),

  async execute(interaction) {
    await interaction.reply(buildWebsiteMessage());
  },

  buildWebsiteMessage
};
