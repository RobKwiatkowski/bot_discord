// Podglad lokalnych statystyk aktywnosci Discorda.
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const {
  formatDuration,
  getRangeStats,
  getUserStats
} = require('../src/features/discordStats');

const PERIOD_CHOICES = [
  { name: 'Dzisiaj', value: 'today' },
  { name: '7 dni', value: '7d' },
  { name: '30 dni', value: '30d' }
];

function addPeriodOption(option) {
  return option
    .setName('okres')
    .setDescription('Zakres statystyk')
    .setRequired(false)
    .addChoices(...PERIOD_CHOICES);
}

function topLines(items, formatter, emptyText = 'Brak danych') {
  if (!items || items.length === 0) return emptyText;
  return items
    .map((item, index) => `${index + 1}. ${formatter(item)}`)
    .join('\n');
}

function displayUser(item) {
  return item.display_name || item.username || item.id || 'Nieznany';
}

function applyGuildDisplayNames(stats, guild) {
  if (!guild) return stats;

  for (const key of ['top_message_users', 'top_voice_users']) {
    for (const item of stats[key] || []) {
      const member = guild.members.cache.get(item.id);
      if (member) {
        item.display_name = member.displayName;
      }
    }
  }

  return stats;
}

function displayChannel(item) {
  return item.name ? `#${item.name}` : item.id || 'Nieznany kanal';
}

function formatDateTime(value) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return 'Brak danych';

  return new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'Europe/Warsaw',
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(timestamp));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('aktywnosc')
    .setDescription('Pokazuje statystyki aktywnosci Discorda')
    .addSubcommand(sub =>
      sub
        .setName('serwer')
        .setDescription('Podsumowanie aktywnosci serwera')
        .addStringOption(addPeriodOption)
    )
    .addSubcommand(sub =>
      sub
        .setName('top')
        .setDescription('Ranking aktywnosci')
        .addStringOption(option =>
          option
            .setName('typ')
            .setDescription('Rodzaj rankingu')
            .setRequired(true)
            .addChoices(
              { name: 'Wiadomosci', value: 'messages' },
              { name: 'Kanaly glosowe', value: 'voice' },
              { name: 'Kanaly tekstowe', value: 'text_channels' },
              { name: 'Kanaly glosowe - ranking kanalow', value: 'voice_channels' }
            )
        )
        .addStringOption(addPeriodOption)
        .addIntegerOption(option =>
          option
            .setName('limit')
            .setDescription('Liczba pozycji od 1 do 10')
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('user')
        .setDescription('Statystyki wybranego uzytkownika')
        .addUserOption(option =>
          option
            .setName('uzytkownik')
            .setDescription('Uzytkownik Discord')
            .setRequired(false)
        )
        .addStringOption(addPeriodOption)
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const period = interaction.options.getString('okres') || '7d';

    if (sub === 'serwer') {
      const stats = applyGuildDisplayNames(getRangeStats(period, 5), interaction.guild);
      const embed = new EmbedBuilder()
        .setColor(0xEAB308)
        .setTitle(`Aktywnosc serwera - ${stats.label}`)
        .addFields(
          { name: 'Wiadomosci', value: String(stats.totals.messages), inline: true },
          { name: 'Czas glosowy', value: formatDuration(stats.totals.voice_seconds), inline: true },
          { name: 'Aktywni', value: String(stats.totals.active_users), inline: true },
          {
            name: 'Top wiadomosci',
            value: topLines(stats.top_message_users, item => `${displayUser(item)} - ${item.messages}`)
          },
          {
            name: 'Najdluzej na glosowych',
            value: topLines(stats.top_voice_users, item => `${displayUser(item)} - ${formatDuration(item.voice_seconds)}`)
          }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'top') {
      const type = interaction.options.getString('typ');
      const limit = interaction.options.getInteger('limit') || 10;
      const stats = applyGuildDisplayNames(getRangeStats(period, limit), interaction.guild);
      const configByType = {
        messages: {
          title: 'Top wiadomosci',
          items: stats.top_message_users,
          formatter: item => `${displayUser(item)} - ${item.messages}`
        },
        voice: {
          title: 'Najdluzej na glosowych',
          items: stats.top_voice_users,
          formatter: item => `${displayUser(item)} - ${formatDuration(item.voice_seconds)}`
        },
        text_channels: {
          title: 'Top kanaly tekstowe',
          items: stats.top_text_channels,
          formatter: item => `${displayChannel(item)} - ${item.messages}`
        },
        voice_channels: {
          title: 'Top kanaly glosowe',
          items: stats.top_voice_channels,
          formatter: item => `${displayChannel(item)} - ${formatDuration(item.voice_seconds)}`
        }
      };
      const selected = configByType[type] || configByType.messages;

      const embed = new EmbedBuilder()
        .setColor(0x22C55E)
        .setTitle(`${selected.title} - ${stats.label}`)
        .setDescription(topLines(selected.items, selected.formatter))
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      return;
    }

    const selectedUser = interaction.options.getUser('uzytkownik') || interaction.user;
    const selectedMember = interaction.options.getMember('uzytkownik') || interaction.member;
    const displayName = selectedMember?.displayName || selectedUser.username;
    const userStats = getUserStats(period, selectedUser.id);
    const embed = new EmbedBuilder()
      .setColor(0x38BDF8)
      .setTitle(`Aktywnosc - ${displayName}`)
      .setThumbnail(selectedUser.displayAvatarURL({ extension: 'png', size: 128 }))
      .setDescription(userStats.label)
      .addFields(
        { name: 'Wiadomosci', value: String(userStats.messages), inline: true },
        { name: 'Czas glosowy', value: formatDuration(userStats.voice_seconds), inline: true },
        { name: 'Sesje glosowe', value: String(userStats.sessions), inline: true },
        { name: 'Ostatnia aktywnosc', value: formatDateTime(userStats.last_active_at), inline: false },
        {
          name: 'Najczestsze kanaly tekstowe',
          value: topLines(
            userStats.top_text_channels,
            item => `${displayChannel(item)} - ${item.messages}`,
            'Brak danych'
          ),
          inline: true
        },
        {
          name: 'Najczestsze kanaly glosowe',
          value: topLines(
            userStats.top_voice_channels,
            item => `${displayChannel(item)} - ${formatDuration(item.voice_seconds)}`,
            'Brak danych'
          ),
          inline: true
        }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
