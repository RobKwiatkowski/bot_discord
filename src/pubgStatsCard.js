const CARD_WIDTH = 1200;
const CARD_HEIGHT = 1000;
const PADDING = 30;
const MODES = [
  { key: 'solo', label: 'SOLO' },
  { key: 'duo', label: 'DUO' },
  { key: 'squad', label: 'SQUAD' },
  { key: 'solo-fpp', label: 'SOLO' },
  { key: 'duo-fpp', label: 'DUO' },
  { key: 'squad-fpp', label: 'SQUAD' }
];
const COLORS = {
  page: '#0f1014',
  panel: '#2f3238',
  panelAlt: '#292c32',
  metric: '#24272d',
  border: '#41454e',
  text: '#f2f3f5',
  muted: '#b7bbc4',
  muted2: '#8c929e',
  accent: '#f2a900',
  accentSoft: '#5a4618',
  tpp: '#f2a900',
  fpp: '#38bdf8'
};

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function divide(numerator, denominator) {
  const top = asNumber(numerator);
  const bottom = asNumber(denominator);
  if (bottom > 0) return top / bottom;
  return top;
}

function formatInteger(value) {
  return Math.round(asNumber(value)).toLocaleString('pl-PL');
}

function formatDecimal(value, digits = 2) {
  return asNumber(value).toFixed(digits).replace('.', ',');
}

function formatPercent(value) {
  return `${formatDecimal(value, 1)}%`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(asNumber(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function summarizeMode(rawStats = {}) {
  const matches = asNumber(rawStats.roundsPlayed);
  const wins = asNumber(rawStats.wins);
  const losses = rawStats.losses == null
    ? Math.max(0, matches - wins)
    : asNumber(rawStats.losses);
  const kills = asNumber(rawStats.kills);
  const assists = asNumber(rawStats.assists);
  const damage = asNumber(rawStats.damageDealt);
  const headshots = asNumber(rawStats.headshotKills);

  return {
    matches,
    wins,
    winRate: divide(wins, matches) * 100,
    top10: asNumber(rawStats.top10s),
    top10Rate: divide(rawStats.top10s, matches) * 100,
    kills,
    assists,
    deaths: losses,
    kd: divide(kills, losses),
    kda: divide(kills + assists, losses),
    avgDamage: divide(damage, matches),
    damage,
    headshots,
    headshotRate: divide(headshots, kills) * 100,
    avgSurvival: divide(rawStats.timeSurvived, matches),
    timeSurvived: asNumber(rawStats.timeSurvived),
    longestKill: asNumber(rawStats.longestKill)
  };
}

function aggregateModes(gameModeStats = {}) {
  const total = MODES.reduce((result, mode) => {
    const stats = summarizeMode(gameModeStats[mode.key]);
    result.matches += stats.matches;
    result.wins += stats.wins;
    result.top10 += stats.top10;
    result.kills += stats.kills;
    result.assists += stats.assists;
    result.deaths += stats.deaths;
    result.damage += stats.damage;
    result.headshots += stats.headshots;
    result.timeSurvived += stats.timeSurvived;
    result.longestKill = Math.max(result.longestKill, stats.longestKill);
    return result;
  }, {
    matches: 0,
    wins: 0,
    top10: 0,
    kills: 0,
    assists: 0,
    deaths: 0,
    damage: 0,
    headshots: 0,
    timeSurvived: 0,
    longestKill: 0
  });

  return {
    ...total,
    winRate: divide(total.wins, total.matches) * 100,
    top10Rate: divide(total.top10, total.matches) * 100,
    kd: divide(total.kills, total.deaths),
    kda: divide(total.kills + total.assists, total.deaths),
    avgDamage: divide(total.damage, total.matches),
    headshotRate: divide(total.headshots, total.kills) * 100,
    avgSurvival: divide(total.timeSurvived, total.matches)
  };
}

function formatSeasonLabel(seasonId, range = 'season') {
  if (range === 'lifetime' || seasonId === 'lifetime') return 'CAŁA KARIERA';

  const match = String(seasonId || '').match(/-(\d+)$/);
  if (match) return `SEZON ${Number(match[1])}`;
  return String(seasonId || 'AKTUALNY SEZON').toUpperCase();
}

function platformLabel(platform) {
  const labels = {
    steam: 'STEAM',
    kakao: 'KAKAO',
    psn: 'PLAYSTATION',
    xbox: 'XBOX',
    console: 'KONSOLE'
  };
  return labels[String(platform || '').toLowerCase()] || String(platform || 'PUBG').toUpperCase();
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

function strokeRoundRect(ctx, x, y, width, height, radius, color, lineWidth = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  roundRect(ctx, x, y, width, height, radius);
  ctx.stroke();
}

function truncateText(ctx, value, maxWidth) {
  const text = String(value || '');
  if (ctx.measureText(text).width <= maxWidth) return text;

  let result = text;
  while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

function drawPill(ctx, x, y, text, color = COLORS.accent) {
  ctx.font = '700 16px Arial';
  const width = ctx.measureText(text).width + 28;
  fillRoundRect(ctx, x, y, width, 32, 16, COLORS.metric);
  strokeRoundRect(ctx, x, y, width, 32, 16, color);
  ctx.fillStyle = color;
  ctx.fillText(text, x + 14, y + 22);
  return width;
}

function drawFallbackLogo(ctx, x, y, size) {
  fillRoundRect(ctx, x, y, size, size, 16, COLORS.metric);
  strokeRoundRect(ctx, x, y, size, size, 16, COLORS.accent, 2);
  ctx.fillStyle = COLORS.accent;
  ctx.font = '800 25px Arial';
  const text = 'PPL';
  ctx.fillText(text, x + size / 2 - ctx.measureText(text).width / 2, y + size / 2 + 9);
}

async function drawHeader(ctx, loadImage, options) {
  const { guild, nickname, platform, seasonId, range } = options;
  const iconSize = 76;
  const iconUrl = typeof guild?.iconURL === 'function'
    ? guild.iconURL({ extension: 'png', size: 128 })
    : '';

  let iconDrawn = false;
  if (iconUrl) {
    try {
      const icon = await loadImage(iconUrl);
      ctx.save();
      roundRect(ctx, PADDING, 24, iconSize, iconSize, 16);
      ctx.clip();
      ctx.drawImage(icon, PADDING, 24, iconSize, iconSize);
      ctx.restore();
      iconDrawn = true;
    } catch {
      iconDrawn = false;
    }
  }
  if (!iconDrawn) drawFallbackLogo(ctx, PADDING, 24, iconSize);

  const textX = PADDING + iconSize + 20;
  ctx.fillStyle = COLORS.accent;
  ctx.font = '700 17px Arial';
  ctx.fillText('PUBG • STATYSTYKI GRACZA', textX, 45);

  ctx.fillStyle = COLORS.text;
  ctx.font = '800 39px Arial';
  ctx.fillText(truncateText(ctx, nickname, 580), textX, 86);

  const seasonText = formatSeasonLabel(seasonId, range);
  const platformText = platformLabel(platform);
  ctx.font = '700 16px Arial';
  const seasonWidth = ctx.measureText(seasonText).width + 28;
  const platformWidth = ctx.measureText(platformText).width + 28;
  const totalWidth = seasonWidth + platformWidth + 12;
  let pillX = CARD_WIDTH - PADDING - totalWidth;
  drawPill(ctx, pillX, 46, platformText, COLORS.muted);
  pillX += platformWidth + 12;
  drawPill(ctx, pillX, 46, seasonText, COLORS.accent);
}

function drawSummaryMetric(ctx, x, y, width, label, value, secondary = '') {
  fillRoundRect(ctx, x, y, width, 86, 10, COLORS.panel);
  strokeRoundRect(ctx, x, y, width, 86, 10, COLORS.border);

  ctx.fillStyle = COLORS.muted;
  ctx.font = '700 14px Arial';
  ctx.fillText(label, x + 16, y + 25);

  ctx.fillStyle = COLORS.text;
  ctx.font = '800 27px Arial';
  ctx.fillText(truncateText(ctx, value, width - 32), x + 16, y + 60);

  if (secondary) {
    ctx.fillStyle = COLORS.muted2;
    ctx.font = '700 13px Arial';
    const secondaryWidth = ctx.measureText(secondary).width;
    ctx.fillText(secondary, x + width - secondaryWidth - 14, y + 58);
  }
}

function drawSummary(ctx, total) {
  ctx.fillStyle = COLORS.muted;
  ctx.font = '800 16px Arial';
  ctx.fillText('PODSUMOWANIE • TPP + FPP', PADDING, 139);

  const gap = 12;
  const width = (CARD_WIDTH - PADDING * 2 - gap * 5) / 6;
  const items = [
    ['MECZE', formatInteger(total.matches)],
    ['WYGRANE', formatInteger(total.wins), formatPercent(total.winRate)],
    ['TOP 10', formatInteger(total.top10), formatPercent(total.top10Rate)],
    ['KILLE', formatInteger(total.kills)],
    ['K/D', formatDecimal(total.kd)],
    ['ŚR. DMG', formatInteger(total.avgDamage)]
  ];

  items.forEach((item, index) => {
    drawSummaryMetric(ctx, PADDING + index * (width + gap), 154, width, ...item);
  });
}

function drawModeMetric(ctx, x, y, width, label, value) {
  ctx.fillStyle = COLORS.muted2;
  ctx.font = '700 13px Arial';
  ctx.fillText(label, x, y + 14);

  ctx.fillStyle = COLORS.text;
  ctx.font = '800 22px Arial';
  ctx.fillText(truncateText(ctx, value, width), x, y + 38);
}

function drawModeCard(ctx, x, y, width, mode, stats, accent) {
  const height = 282;
  fillRoundRect(ctx, x, y, width, height, 12, COLORS.panelAlt);
  strokeRoundRect(ctx, x, y, width, height, 12, COLORS.border);

  ctx.save();
  roundRect(ctx, x, y, width, height, 12);
  ctx.clip();
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, width, 5);
  ctx.restore();

  ctx.fillStyle = COLORS.text;
  ctx.font = '800 25px Arial';
  ctx.fillText(mode.label, x + 18, y + 37);

  ctx.fillStyle = stats.matches > 0 ? accent : COLORS.muted2;
  ctx.font = '700 14px Arial';
  const status = stats.matches > 0 ? `${formatInteger(stats.matches)} MECZÓW` : 'BRAK MECZÓW';
  ctx.fillText(status, x + width - ctx.measureText(status).width - 18, y + 35);

  ctx.strokeStyle = COLORS.border;
  ctx.beginPath();
  ctx.moveTo(x + 18, y + 54);
  ctx.lineTo(x + width - 18, y + 54);
  ctx.stroke();

  const columnGap = 18;
  const metricWidth = (width - 36 - columnGap) / 2;
  const rows = [
    [
      ['MECZE', formatInteger(stats.matches)],
      ['WYGRANE', `${formatInteger(stats.wins)} • ${formatPercent(stats.winRate)}`]
    ],
    [
      ['TOP 10', `${formatInteger(stats.top10)} • ${formatPercent(stats.top10Rate)}`],
      ['KILLE', formatInteger(stats.kills)]
    ],
    [
      ['K/D', formatDecimal(stats.kd)],
      ['KDA', formatDecimal(stats.kda)]
    ],
    [
      ['ŚR. DMG / MECZ', formatInteger(stats.avgDamage)],
      ['HEADSHOTY', formatPercent(stats.headshotRate)]
    ]
  ];

  rows.forEach((row, rowIndex) => {
    const rowY = y + 66 + rowIndex * 43;
    row.forEach((metric, columnIndex) => {
      drawModeMetric(
        ctx,
        x + 18 + columnIndex * (metricWidth + columnGap),
        rowY,
        metricWidth,
        metric[0],
        metric[1]
      );
    });
  });

  const detailY = y + 245;
  fillRoundRect(ctx, x + 14, detailY, width - 28, 25, 6, COLORS.metric);
  ctx.fillStyle = COLORS.muted;
  ctx.font = '700 12px Arial';
  ctx.fillText(`ŚR. ŻYCIA  ${formatDuration(stats.avgSurvival)}`, x + 25, detailY + 17);
  const longest = `NAJDŁ. KILL  ${formatInteger(stats.longestKill)} m`;
  ctx.fillText(longest, x + width - ctx.measureText(longest).width - 25, detailY + 17);
}

function drawModeSection(ctx, y, label, subtitle, modes, gameModeStats, accent) {
  ctx.fillStyle = accent;
  ctx.font = '800 23px Arial';
  ctx.fillText(label, PADDING, y);
  const labelWidth = ctx.measureText(label).width;

  ctx.fillStyle = COLORS.muted2;
  ctx.font = '700 15px Arial';
  ctx.fillText(subtitle, PADDING + labelWidth + 14, y);

  const gap = 18;
  const width = (CARD_WIDTH - PADDING * 2 - gap * 2) / 3;
  modes.forEach((mode, index) => {
    drawModeCard(
      ctx,
      PADDING + index * (width + gap),
      y + 18,
      width,
      mode,
      summarizeMode(gameModeStats[mode.key]),
      accent
    );
  });
}

function drawFooter(ctx, options) {
  const y = CARD_HEIGHT - 25;
  ctx.fillStyle = COLORS.muted;
  ctx.font = '700 14px Arial';
  const note = options.range === 'lifetime'
    ? 'Kariera od systemu Survival Title • KDA uwzględnia asysty • DMG to średnia / mecz'
    : 'KDA uwzględnia asysty • DMG to średnia / mecz';
  ctx.fillText(note, PADDING, y);

  const powered = 'PolishPUBGLegion • Oficjalne PUBG API';
  ctx.fillStyle = COLORS.muted2;
  ctx.fillText(powered, CARD_WIDTH - PADDING - ctx.measureText(powered).width, y);
}

async function renderPubgStatsCard(options) {
  const { createCanvas, loadImage } = require('canvas');
  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext('2d');
  const gameModeStats = options.gameModeStats || {};

  ctx.fillStyle = COLORS.page;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  fillRoundRect(ctx, 8, 8, CARD_WIDTH - 16, CARD_HEIGHT - 16, 22, COLORS.panel);
  strokeRoundRect(ctx, 9, 9, CARD_WIDTH - 18, CARD_HEIGHT - 18, 22, COLORS.border);

  await drawHeader(ctx, loadImage, options);
  drawSummary(ctx, aggregateModes(gameModeStats));
  drawModeSection(ctx, 283, 'TPP', 'TRZECIA OSOBA', MODES.slice(0, 3), gameModeStats, COLORS.tpp);
  drawModeSection(ctx, 632, 'FPP', 'PIERWSZA OSOBA', MODES.slice(3), gameModeStats, COLORS.fpp);
  drawFooter(ctx, options);

  return canvas.toBuffer('image/png');
}

module.exports = {
  MODES,
  aggregateModes,
  formatDecimal,
  formatInteger,
  formatPercent,
  formatSeasonLabel,
  platformLabel,
  renderPubgStatsCard,
  summarizeMode
};
