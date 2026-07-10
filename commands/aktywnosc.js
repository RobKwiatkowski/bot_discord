// Podglad lokalnych statystyk aktywnosci Discorda.
const { AttachmentBuilder, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { config } = require('../src/config');
const {
  formatDuration,
  getRangeStats,
  getUserStats
} = require('../src/features/discordStats');

const CARD_WIDTH = 1100;
const CARD_PADDING = 26;
const ROW_HEIGHT = 52;
const ROW_GAP = 8;
const CARD_FOOTER_HEIGHT = 74;
const COLORS = {
  page: '#0f1014',
  card: '#2f3238',
  cardBorder: '#3f434b',
  row: '#3a3d44',
  rowAlt: '#34373e',
  rank: '#25282e',
  text: '#f2f3f5',
  muted: '#b7bbc4',
  muted2: '#8c929e',
  valueBg: '#25282e',
  accent: '#00a86b',
  yellow: '#f2c94c'
};
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

function periodLookback(stats) {
  const days = stats.days?.length || 0;
  if (stats.period === 'today') return 'Today';
  if (stats.period === 'all') return days > 0 ? `All saved days (${days})` : 'All saved days';
  return `Last ${days || stats.period.replace('d', '')} days`;
}

function displayUser(item) {
  return item.display_name || item.username || item.id || 'Nieznany';
}

function applyGuildDisplayNames(stats, guild) {
  if (!guild) return stats;

  for (const key of ['top_message_users', 'top_voice_users', 'top_game_users', 'top_game_pairs', 'top_invites']) {
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

function asciiFoldPolish(text) {
  return String(text || '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function cleanChannelNameForCard(name) {
  let clean = String(name || '').normalize('NFKC');
  const parts = clean.split(/[|｜︱│┃]/u).map(part => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    clean = parts[parts.length - 1];
  }

  clean = clean
    .replace(/[\u200B-\u200D\uFE0E\uFE0F]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[^\p{L}\p{N}\s._#[\]\-()]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return asciiFoldPolish(clean);
}

function displayChannelForCard(item) {
  const clean = cleanChannelNameForCard(item.name || item.channel_name || '');
  if (clean) return `# ${clean}`;
  return item.id ? `# ${item.id}` : '# kanal';
}

function displayTopItem(item, isChannel) {
  return isChannel ? displayChannel(item) : displayUser(item);
}

function displayNamedItem(item) {
  return item.name || item.id || 'Nieznane';
}

function displayGamePair(item) {
  const userName = displayUser(item);
  const gameName = item.game_name || item.name || 'Nieznana gra';
  return `${userName} - ${gameName}`;
}

function compactDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total >= 3600) return `${(total / 3600).toFixed(2)} hr`;
  if (total >= 60) return formatDuration(total);
  return `${total}s`;
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

function topConfig(type, stats) {
  const map = {
    messages: {
      title: 'Top wiadomosci',
      subtitle: 'Top Message Members',
      items: stats.top_message_users,
      color: 0xf2c94c,
      isChannel: false,
      value: item => `${item.messages || item.value || 0}`
    },
    voice: {
      title: 'Najdluzej na glosowych',
      subtitle: 'Top Voice Members',
      items: stats.top_voice_users,
      color: 0x00a86b,
      isChannel: false,
      value: item => compactDuration(item.voice_seconds || item.value || 0)
    },
    game_users: {
      title: 'Najdluzej w grach',
      subtitle: 'Top Game Members',
      items: stats.top_game_users,
      color: 0x94a3b8,
      isChannel: false,
      value: item => compactDuration(item.game_seconds || item.value || 0)
    },
    games: {
      title: 'Top gry',
      subtitle: 'Top Games',
      items: stats.top_games,
      color: 0x94a3b8,
      isChannel: false,
      name: displayNamedItem,
      value: item => compactDuration(item.game_seconds || item.value || 0)
    },
    game_pairs: {
      title: 'Kto w co gral',
      subtitle: 'Members by Game',
      items: stats.top_game_pairs,
      color: 0x94a3b8,
      isChannel: false,
      name: displayGamePair,
      value: item => compactDuration(item.game_seconds || item.value || 0)
    },
    invites: {
      title: 'Zaproszenia',
      subtitle: 'Top Invites',
      items: stats.top_invites,
      color: 0xef4444,
      isChannel: false,
      value: item => `${item.invites || item.value || 0}`
    },
    text_channels: {
      title: 'Kanaly tekstowe',
      subtitle: 'Top Text Channels',
      items: stats.top_text_channels,
      color: 0x38bdf8,
      isChannel: true,
      value: item => `${item.messages || item.value || 0}`
    },
    voice_channels: {
      title: 'Kanaly glosowe',
      subtitle: 'Top Voice Channels',
      items: stats.top_voice_channels,
      color: 0x00a86b,
      isChannel: true,
      value: item => compactDuration(item.voice_seconds || item.value || 0)
    }
  };

  return map[type] || map.messages;
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, width, height, radius, color) {
  ctx.fillStyle = color;
  roundRect(ctx, x, y, width, height, radius);
  ctx.fill();
}

function strokeRoundRect(ctx, x, y, width, height, radius, color) {
  ctx.strokeStyle = color;
  roundRect(ctx, x, y, width, height, radius);
  ctx.stroke();
}

function truncateText(ctx, text, maxWidth) {
  const value = String(text || '');
  if (ctx.measureText(value).width <= maxWidth) return value;

  let result = value;
  while (result.length > 1 && ctx.measureText(`${result}...`).width > maxWidth) {
    result = result.slice(0, -1);
  }

  return `${result}...`;
}

async function drawGuildHeader(ctx, loadImage, guild, stats, sectionLabel) {
  const x = CARD_PADDING;
  const y = CARD_PADDING;
  const iconSize = 68;
  const guildName = guild?.name || 'Polish PUBG Legion';
  const iconUrl = typeof guild?.iconURL === 'function'
    ? guild.iconURL({ extension: 'png', size: 128 })
    : '';

  fillRoundRect(ctx, x, y, iconSize, iconSize, 14, '#20232a');
  if (iconUrl) {
    try {
      const image = await loadImage(iconUrl);
      ctx.save();
      roundRect(ctx, x, y, iconSize, iconSize, 14);
      ctx.clip();
      ctx.drawImage(image, x, y, iconSize, iconSize);
      ctx.restore();
    } catch {
      ctx.fillStyle = COLORS.yellow;
      ctx.font = '700 24px Arial';
      ctx.fillText('PPL', x + 13, y + 43);
    }
  } else {
    ctx.fillStyle = COLORS.yellow;
    ctx.font = '700 24px Arial';
    ctx.fillText('PPL', x + 13, y + 43);
  }

  ctx.fillStyle = COLORS.text;
  ctx.font = '700 37px Arial';
  ctx.fillText(truncateText(ctx, guildName, CARD_WIDTH - x - iconSize - 70), x + iconSize + 18, y + 32);

  ctx.fillStyle = COLORS.muted;
  ctx.font = '700 23px Arial';
  ctx.fillText(sectionLabel, x + iconSize + 18, y + 62);

  ctx.fillStyle = COLORS.muted2;
  ctx.font = '700 17px Arial';
  ctx.fillText(`Server Lookback: ${periodLookback(stats)} - Timezone: ${config.discordStats.timezone}`, x, y + 98);
}

function drawFooter(ctx, stats) {
  const y = ctx.canvas.height - 30;
  ctx.fillStyle = COLORS.muted;
  ctx.font = '700 16px Arial';
  ctx.fillText(`Server Lookback: ${periodLookback(stats)} - Timezone: ${config.discordStats.timezone}`, CARD_PADDING, y);

  const powered = 'Powered by Sentinel';
  ctx.fillStyle = COLORS.muted2;
  ctx.font = '700 16px Arial';
  ctx.fillText(powered, CARD_WIDTH - CARD_PADDING - ctx.measureText(powered).width, y);
}

function drawRankingRows(ctx, items, options) {
  const {
    x,
    y,
    width,
    title,
    valueFormatter,
    isChannel = false,
    nameFormatter = null,
    forceColumns = null,
    maxItems = 10
  } = options;
  const rows = Array.isArray(items) ? items.slice(0, maxItems) : [];

  ctx.fillStyle = COLORS.text;
  ctx.font = '700 24px Arial';
  ctx.fillText(title, x, y);

  if (rows.length === 0) {
    ctx.fillStyle = COLORS.muted;
    ctx.font = '700 20px Arial';
    ctx.fillText('Brak danych.', x, y + 44);
    return y + 72;
  }

  const columns = forceColumns || (rows.length > 5 ? 2 : 1);
  const columnGap = columns === 2 ? 22 : 0;
  const columnWidth = (width - columnGap) / columns;
  const rowsPerColumn = Math.ceil(rows.length / columns);
  const startY = y + 20;

  for (let index = 0; index < rows.length; index += 1) {
    const column = Math.floor(index / rowsPerColumn);
    const row = index % rowsPerColumn;
    const rowX = x + column * (columnWidth + columnGap);
    const rowY = startY + row * (ROW_HEIGHT + ROW_GAP);
    const item = rows[index];
    const value = valueFormatter(item);

    fillRoundRect(ctx, rowX, rowY, columnWidth, ROW_HEIGHT, 6, index % 2 === 0 ? COLORS.row : COLORS.rowAlt);
    fillRoundRect(ctx, rowX + 8, rowY + 7, 44, 38, 5, COLORS.rank);
    ctx.fillStyle = COLORS.text;
    ctx.font = '700 21px Arial';
    const rank = String(index + 1);
    ctx.fillText(rank, rowX + 30 - ctx.measureText(rank).width / 2, rowY + 33);

    ctx.font = '700 21px Arial';
    const valueWidth = Math.max(92, ctx.measureText(value).width + 26);
    fillRoundRect(ctx, rowX + columnWidth - valueWidth - 10, rowY + 8, valueWidth, 36, 5, COLORS.valueBg);
    ctx.fillStyle = COLORS.text;
    ctx.fillText(value, rowX + columnWidth - valueWidth / 2 - 10 - ctx.measureText(value).width / 2, rowY + 32);

    ctx.fillStyle = COLORS.text;
    const nameMaxWidth = columnWidth - valueWidth - 82;
    const rowName = nameFormatter ? nameFormatter(item) : isChannel ? displayChannelForCard(item) : displayUser(item);
    ctx.fillText(truncateText(ctx, rowName, nameMaxWidth), rowX + 64, rowY + 33);
  }

  return startY + rowsPerColumn * (ROW_HEIGHT + ROW_GAP) + 12;
}

function drawMetric(ctx, x, y, width, label, value) {
  fillRoundRect(ctx, x, y, width, 84, 8, COLORS.row);
  ctx.fillStyle = COLORS.muted;
  ctx.font = '700 17px Arial';
  ctx.fillText(label, x + 18, y + 30);
  ctx.fillStyle = COLORS.text;
  ctx.font = '700 31px Arial';
  ctx.fillText(String(value), x + 18, y + 65);
}

function drawMiniMetric(ctx, x, y, width, label, value) {
  fillRoundRect(ctx, x, y, width, 74, 8, COLORS.row);
  ctx.fillStyle = COLORS.muted;
  ctx.font = '700 15px Arial';
  ctx.fillText(label, x + 16, y + 26);
  ctx.fillStyle = COLORS.text;
  ctx.font = '700 25px Arial';
  ctx.fillText(truncateText(ctx, String(value), width - 30), x + 16, y + 58);
}

async function drawUserAvatar(ctx, loadImage, user, x, y, size) {
  const avatarUrl = typeof user?.displayAvatarURL === 'function'
    ? user.displayAvatarURL({ extension: 'png', size: 128 })
    : '';

  fillRoundRect(ctx, x, y, size, size, 14, '#20232a');
  if (!avatarUrl) {
    ctx.fillStyle = COLORS.yellow;
    ctx.font = '700 25px Arial';
    ctx.fillText('U', x + size / 2 - 9, y + size / 2 + 9);
    return;
  }

  try {
    const image = await loadImage(avatarUrl);
    ctx.save();
    roundRect(ctx, x, y, size, size, 14);
    ctx.clip();
    ctx.drawImage(image, x, y, size, size);
    ctx.restore();
  } catch {
    ctx.fillStyle = COLORS.yellow;
    ctx.font = '700 25px Arial';
    ctx.fillText('U', x + size / 2 - 9, y + size / 2 + 9);
  }
}

async function renderTopStatsCard({ guild, stats, selected }) {
  const { createCanvas, loadImage } = require('canvas');
  const rows = Array.isArray(selected.items) ? selected.items.slice(0, 10) : [];
  const rowCount = Math.max(1, Math.ceil(rows.length / (rows.length > 5 ? 2 : 1)));
  const tableStartY = 168;
  const tableHeight = rowCount * (ROW_HEIGHT + ROW_GAP);
  const height = Math.max(430, tableStartY + tableHeight + CARD_FOOTER_HEIGHT);
  const canvas = createCanvas(CARD_WIDTH, height);
  const ctx = canvas.getContext('2d');

  fillRoundRect(ctx, 0, 0, CARD_WIDTH, height, 0, COLORS.page);
  fillRoundRect(ctx, 0, 0, CARD_WIDTH, height, 28, COLORS.card);
  strokeRoundRect(ctx, 1, 1, CARD_WIDTH - 2, height - 2, 28, COLORS.cardBorder);

  await drawGuildHeader(ctx, loadImage, guild, stats, 'Top Statistics');
  drawRankingRows(ctx, rows, {
    x: CARD_PADDING,
    y: 148,
    width: CARD_WIDTH - CARD_PADDING * 2,
    title: selected.subtitle,
    valueFormatter: selected.value,
    isChannel: selected.isChannel,
    nameFormatter: selected.name,
    maxItems: 10
  });
  drawFooter(ctx, stats);

  return canvas.toBuffer('image/png');
}

async function renderServerStatsCard({ guild, stats }) {
  const { createCanvas, loadImage } = require('canvas');
  const listStartY = 264;
  const listRows = Math.max(
    Math.min(5, Math.max(1, (stats.top_message_users || []).length)),
    Math.min(5, Math.max(1, (stats.top_voice_users || []).length))
  );
  const height = Math.max(690, listStartY + 20 + listRows * (ROW_HEIGHT + ROW_GAP) + CARD_FOOTER_HEIGHT);
  const canvas = createCanvas(CARD_WIDTH, height);
  const ctx = canvas.getContext('2d');

  fillRoundRect(ctx, 0, 0, CARD_WIDTH, height, 0, COLORS.page);
  fillRoundRect(ctx, 0, 0, CARD_WIDTH, height, 28, COLORS.card);
  strokeRoundRect(ctx, 1, 1, CARD_WIDTH - 2, height - 2, 28, COLORS.cardBorder);

  await drawGuildHeader(ctx, loadImage, guild, stats, 'Server Activity');

  const metricY = 138;
  const metricGap = 16;
  const metricWidth = (CARD_WIDTH - CARD_PADDING * 2 - metricGap * 3) / 4;
  drawMetric(ctx, CARD_PADDING, metricY, metricWidth, 'Wiadomosci', stats.totals.messages);
  drawMetric(ctx, CARD_PADDING + metricWidth + metricGap, metricY, metricWidth, 'Czas glosowy', formatDuration(stats.totals.voice_seconds));
  drawMetric(ctx, CARD_PADDING + (metricWidth + metricGap) * 2, metricY, metricWidth, 'Czas w grach', formatDuration(stats.totals.game_seconds));
  drawMetric(ctx, CARD_PADDING + (metricWidth + metricGap) * 3, metricY, metricWidth, 'Aktywni', stats.totals.active_users);

  const listY = metricY + 126;
  const listGap = 24;
  const listWidth = (CARD_WIDTH - CARD_PADDING * 2 - listGap) / 2;
  drawRankingRows(ctx, stats.top_message_users || [], {
    x: CARD_PADDING,
    y: listY,
    width: listWidth,
    title: 'Top Message Members',
    valueFormatter: item => `${item.messages || item.value || 0}`,
    maxItems: 5,
    forceColumns: 1
  });
  drawRankingRows(ctx, stats.top_voice_users || [], {
    x: CARD_PADDING + listWidth + listGap,
    y: listY,
    width: listWidth,
    title: 'Top Voice Members',
    valueFormatter: item => compactDuration(item.voice_seconds || item.value || 0),
    maxItems: 5,
    forceColumns: 1
  });
  drawFooter(ctx, stats);

  return canvas.toBuffer('image/png');
}

async function renderUserStatsCard({ guild, periodStats, userStats, user, displayName }) {
  const { createCanvas, loadImage } = require('canvas');
  const textChannels = Array.isArray(userStats.top_text_channels) ? userStats.top_text_channels.slice(0, 5) : [];
  const voiceChannels = Array.isArray(userStats.top_voice_channels) ? userStats.top_voice_channels.slice(0, 5) : [];
  const games = Array.isArray(userStats.top_games) ? userStats.top_games.slice(0, 5) : [];
  const rowCount = Math.max(textChannels.length, voiceChannels.length, games.length, 1);
  const listStartY = 394;
  const height = Math.max(680, listStartY + 20 + rowCount * (ROW_HEIGHT + ROW_GAP) + CARD_FOOTER_HEIGHT);
  const canvas = createCanvas(CARD_WIDTH, height);
  const ctx = canvas.getContext('2d');

  fillRoundRect(ctx, 0, 0, CARD_WIDTH, height, 0, COLORS.page);
  fillRoundRect(ctx, 0, 0, CARD_WIDTH, height, 28, COLORS.card);
  strokeRoundRect(ctx, 1, 1, CARD_WIDTH - 2, height - 2, 28, COLORS.cardBorder);

  await drawGuildHeader(ctx, loadImage, guild, periodStats, 'Member Statistics');

  const avatarSize = 104;
  const profileY = 142;
  await drawUserAvatar(ctx, loadImage, user, CARD_PADDING, profileY, avatarSize);

  ctx.fillStyle = COLORS.text;
  ctx.font = '700 35px Arial';
  ctx.fillText(truncateText(ctx, displayName, CARD_WIDTH - CARD_PADDING * 2 - avatarSize - 24), CARD_PADDING + avatarSize + 22, profileY + 35);

  ctx.fillStyle = COLORS.muted;
  ctx.font = '700 18px Arial';
  ctx.fillText(userStats.label || periodStats.label || 'Statystyki', CARD_PADDING + avatarSize + 22, profileY + 65);
  ctx.fillText(`Ostatnia aktywnosc: ${formatDateTime(userStats.last_active_at)}`, CARD_PADDING + avatarSize + 22, profileY + 92);

  const metricY = profileY + avatarSize + 28;
  const metricGap = 14;
  const metricWidth = (CARD_WIDTH - CARD_PADDING * 2 - metricGap * 3) / 4;
  drawMiniMetric(ctx, CARD_PADDING, metricY, metricWidth, 'Wiadomosci', userStats.messages);
  drawMiniMetric(ctx, CARD_PADDING + (metricWidth + metricGap), metricY, metricWidth, 'Czas glosowy', formatDuration(userStats.voice_seconds));
  drawMiniMetric(ctx, CARD_PADDING + (metricWidth + metricGap) * 2, metricY, metricWidth, 'Czas w grach', formatDuration(userStats.game_seconds));
  drawMiniMetric(ctx, CARD_PADDING + (metricWidth + metricGap) * 3, metricY, metricWidth, 'Zaproszenia', userStats.invites);

  const listY = metricY + 120;
  const listGap = 18;
  const listWidth = (CARD_WIDTH - CARD_PADDING * 2 - listGap * 2) / 3;
  drawRankingRows(ctx, textChannels, {
    x: CARD_PADDING,
    y: listY,
    width: listWidth,
    title: 'Favorite Text Channels',
    valueFormatter: item => `${item.messages || item.value || 0}`,
    isChannel: true,
    maxItems: 5,
    forceColumns: 1
  });
  drawRankingRows(ctx, voiceChannels, {
    x: CARD_PADDING + listWidth + listGap,
    y: listY,
    width: listWidth,
    title: 'Favorite Voice Channels',
    valueFormatter: item => compactDuration(item.voice_seconds || item.value || 0),
    isChannel: true,
    maxItems: 5,
    forceColumns: 1
  });
  drawRankingRows(ctx, games, {
    x: CARD_PADDING + (listWidth + listGap) * 2,
    y: listY,
    width: listWidth,
    title: 'Favorite Games',
    valueFormatter: item => compactDuration(item.game_seconds || item.value || 0),
    nameFormatter: displayNamedItem,
    maxItems: 5,
    forceColumns: 1
  });
  drawFooter(ctx, periodStats);

  return canvas.toBuffer('image/png');
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
              { name: 'Uzytkownicy glosowo', value: 'voice' },
              { name: 'Uzytkownicy - gry', value: 'game_users' },
              { name: 'Kto w co gral', value: 'game_pairs' },
              { name: 'Gry', value: 'games' },
              { name: 'Zaproszenia', value: 'invites' },
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
      await interaction.deferReply();
      const stats = applyGuildDisplayNames(getRangeStats(period, 5), interaction.guild);

      try {
        const buffer = await renderServerStatsCard({ guild: interaction.guild, stats });
        const attachment = new AttachmentBuilder(buffer, { name: 'aktywnosc-serwer.png' });
        await interaction.editReply({ files: [attachment] });
      } catch (error) {
        console.error('[aktywnosc] Blad renderowania karty serwera:', error);
        const embed = new EmbedBuilder()
          .setColor(0xEAB308)
          .setTitle(`Aktywnosc serwera - ${stats.label}`)
          .addFields(
            { name: 'Wiadomosci', value: String(stats.totals.messages), inline: true },
            { name: 'Czas glosowy', value: formatDuration(stats.totals.voice_seconds), inline: true },
            { name: 'Czas w grach', value: formatDuration(stats.totals.game_seconds), inline: true },
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

        await interaction.editReply({ embeds: [embed] });
      }
      return;
    }

    if (sub === 'top') {
      await interaction.deferReply();
      const type = interaction.options.getString('typ');
      const limit = interaction.options.getInteger('limit') || 10;
      const stats = applyGuildDisplayNames(getRangeStats(period, limit), interaction.guild);
      const selected = topConfig(type, stats);

      try {
        const buffer = await renderTopStatsCard({ guild: interaction.guild, stats, selected });
        const attachment = new AttachmentBuilder(buffer, { name: 'aktywnosc-top.png' });
        await interaction.editReply({ files: [attachment] });
      } catch (error) {
        console.error('[aktywnosc] Blad renderowania karty top:', error);
        const embed = new EmbedBuilder()
          .setColor(selected.color)
          .setTitle(`${selected.title} - ${stats.label}`)
          .setDescription(topLines(selected.items, item => `${selected.name ? selected.name(item) : displayTopItem(item, selected.isChannel)} - ${selected.value(item)}`))
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      }
      return;
    }

    await interaction.deferReply();
    const selectedUser = interaction.options.getUser('uzytkownik') || interaction.user;
    const selectedMember = interaction.options.getMember('uzytkownik') || interaction.member;
    const displayName = selectedMember?.displayName || selectedUser.username;
    const userStats = getUserStats(period, selectedUser.id);
    const periodStats = getRangeStats(period, 5);

    try {
      const buffer = await renderUserStatsCard({
        guild: interaction.guild,
        periodStats,
        userStats,
        user: selectedUser,
        displayName
      });
      const attachment = new AttachmentBuilder(buffer, { name: 'aktywnosc-user.png' });
      await interaction.editReply({ files: [attachment] });
    } catch (error) {
      console.error('[aktywnosc] Blad renderowania karty uzytkownika:', error);
      const embed = new EmbedBuilder()
        .setColor(0x38BDF8)
        .setTitle(`Aktywnosc - ${displayName}`)
        .setThumbnail(selectedUser.displayAvatarURL({ extension: 'png', size: 128 }))
        .setDescription(userStats.label)
        .addFields(
          { name: 'Wiadomosci', value: String(userStats.messages), inline: true },
          { name: 'Czas glosowy', value: formatDuration(userStats.voice_seconds), inline: true },
          { name: 'Czas w grach', value: formatDuration(userStats.game_seconds), inline: true },
          { name: 'Zaproszenia', value: String(userStats.invites), inline: true },
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
          },
          {
            name: 'Ulubione gry',
            value: topLines(
              userStats.top_games,
              item => `${displayNamedItem(item)} - ${formatDuration(item.game_seconds)}`,
              'Brak danych'
            ),
            inline: true
          }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  }
};
