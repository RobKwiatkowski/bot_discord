// Automatic PUBG chicken dinner announcements for tracked LEGION members.
const { AttachmentBuilder } = require('discord.js');
const { config } = require('../config');
const { readJson, writeJson } = require('../jsonStore');
const { getPlayersByNames, pubgRequest } = require('../pubgApi');
const { getMembers } = require('../../klan/clanStore');

const MAX_STORED_MATCH_IDS = 700;
const MIN_CHECK_INTERVAL_MS = 60 * 1000;
const DEFAULT_IMAGE_WIDTH = 1200;
const MAX_PLAYER_NAMES_PER_REQUEST = 10;

const mapLabels = {
  Baltic_Main: 'Erangel',
  Chimera_Main: 'Paramo',
  Desert_Main: 'Miramar',
  DihorOtok_Main: 'Vikendi',
  Erangel_Main: 'Erangel',
  Heaven_Main: 'Haven',
  Kiki_Main: 'Deston',
  Neon_Main: 'Rondo',
  Savage_Main: 'Sanhok',
  Summerland_Main: 'Karakin',
  Tiger_Main: 'Taego'
};

let checkInProgress = false;
let missingApiWarned = false;
let missingChannelWarned = false;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function pickFirst(values) {
  return values.find(value => String(value || '').trim()) || '';
}

function normalizePubgNickname(value) {
  let nickname = String(value || '').trim();
  if (!nickname) return '';

  if (/^<@!?\d+>$/.test(nickname)) return '';
  nickname = nickname.replace(/^@+/, '').trim();

  if (!nickname || /^\d{16,22}$/.test(nickname)) return '';
  if (/[<>\s]/.test(nickname)) return '';

  return nickname;
}

function pickFirstPubgNickname(values) {
  for (const value of values) {
    const nickname = normalizePubgNickname(value);
    if (nickname) return nickname;
  }
  return '';
}

function normalizeClanTag(value) {
  const tag = String(value || '').trim().replace(/^\[|\]$/g, '');
  return tag ? tag.slice(0, 12).toUpperCase() : '';
}

function uniqueIds(ids) {
  return [...new Set(ids.filter(Boolean))].slice(-MAX_STORED_MATCH_IDS);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isRateLimitError(error) {
  return error?.status === 429 || /PUBG API 429/.test(String(error?.message || ''));
}

function loadChickenState() {
  const raw = readJson(config.files.chickenDinners, {
    initializedAt: null,
    seenMatchIds: [],
    announcedMatchIds: [],
    pendingMatchIds: []
  });

  return {
    initializedAt: raw?.initializedAt || null,
    seenMatchIds: Array.isArray(raw?.seenMatchIds) ? raw.seenMatchIds : [],
    announcedMatchIds: Array.isArray(raw?.announcedMatchIds) ? raw.announcedMatchIds : [],
    pendingMatchIds: Array.isArray(raw?.pendingMatchIds) ? raw.pendingMatchIds : []
  };
}

function saveChickenState(state) {
  writeJson(config.files.chickenDinners, {
    initializedAt: state.initializedAt || new Date().toISOString(),
    seenMatchIds: uniqueIds(state.seenMatchIds || []),
    announcedMatchIds: uniqueIds(state.announcedMatchIds || []),
    pendingMatchIds: uniqueIds(state.pendingMatchIds || [])
  });
}

function addTrackedPlayer(players, nickname, data = {}) {
  const pubgNick = String(nickname || '').trim();
  if (!pubgNick) return;

  const key = normalizeName(pubgNick);
  const existing = players.get(key) || {};
  players.set(key, {
    pubgNick,
    displayName: existing.displayName || data.displayName || pubgNick,
    discordId: existing.discordId || data.discordId || null,
    avatarUrl: existing.avatarUrl || data.avatarUrl || null,
    clanTag: existing.clanTag || normalizeClanTag(data.clanTag),
    source: existing.source || data.source || 'clan'
  });
}

function loadTrackedPlayers() {
  const players = new Map();
  const bindings = readJson(config.files.bindings, {});
  const clanTopList = readJson(config.files.clanList, []);

  for (const member of getMembers()) {
    const pubgNick = pickFirstPubgNickname([
      member.pubgNick,
      member.pubgName,
      member.pubgNickname,
      member.pubg,
      bindings[member.id],
      member.nickname,
      member.username,
      member.tag
    ]);

    addTrackedPlayer(players, pubgNick, {
      displayName: member.username || member.tag || pubgNick,
      discordId: member.id,
      avatarUrl: member.avatarUrl,
      clanTag: pickFirst([
        member.clanTag,
        member.pubgClanTag,
        member.pubgClan,
        member.clanShort
      ]) || config.pubg.clanTag,
      source: 'listaklanu'
    });
  }

  for (const nick of clanTopList) {
    addTrackedPlayer(players, nick, {
      displayName: nick,
      clanTag: config.pubg.clanTag,
      source: 'klan'
    });
  }

  return [...players.values()];
}

async function collectRecentMatchIds(maxRequests) {
  const trackedPlayers = loadTrackedPlayers();
  const resolvedPlayers = [];
  const matchIds = new Set();
  const lookback = Math.max(1, config.pubg.chickenMatchLookback || 5);
  const requestDelay = Math.max(0, config.pubg.chickenRequestDelayMs || 0);
  const chunks = chunkArray(trackedPlayers, MAX_PLAYER_NAMES_PER_REQUEST);
  let requestsUsed = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    if (requestsUsed >= maxRequests) break;
    if (requestsUsed > 0 && requestDelay > 0) await delay(requestDelay);

    const chunk = chunks[index];
    const trackedByName = new Map(chunk.map(player => [normalizeName(player.pubgNick), player]));
    const resolvedNames = new Set();

    try {
      requestsUsed += 1;
      const players = await getPlayersByNames(chunk.map(player => player.pubgNick));

      for (const player of players) {
        const pubgName = player.attributes?.name || '';
        const tracked = trackedByName.get(normalizeName(pubgName));
        if (!tracked) continue;

        resolvedNames.add(normalizeName(tracked.pubgNick));
        resolvedPlayers.push({
          ...tracked,
          pubgName: pubgName || tracked.pubgNick,
          playerId: player.id
        });

        const matches = player.relationships?.matches?.data || [];
        for (const match of matches.slice(0, lookback)) {
          if (match?.id) matchIds.add(match.id);
        }
      }

      for (const tracked of chunk) {
        if (!resolvedNames.has(normalizeName(tracked.pubgNick))) {
          console.log(`[pubgChickenDinners] Nie znaleziono gracza PUBG: ${tracked.pubgNick}`);
        }
      }
    } catch (error) {
      if (isRateLimitError(error)) throw error;
      console.error(
        `[pubgChickenDinners] Blad pobierania paczki graczy ` +
        `(${chunk.map(player => player.pubgNick).join(', ')}): ${error.message}`
      );
    }
  }

  return {
    resolvedPlayers,
    matchIds: [...matchIds],
    requestsUsed
  };
}

async function fetchMatch(matchId) {
  return pubgRequest(`https://api.pubg.com/shards/${config.pubg.platform}/matches/${matchId}`);
}

async function fetchClan(clanId) {
  return pubgRequest(`https://api.pubg.com/shards/${config.pubg.platform}/clans/${clanId}`);
}

function buildTrackedIndexes(players) {
  const byId = new Map();
  const byName = new Map();

  for (const player of players) {
    if (player.playerId) byId.set(player.playerId, player);
    if (player.pubgName) byName.set(normalizeName(player.pubgName), player);
    if (player.pubgNick) byName.set(normalizeName(player.pubgNick), player);
  }

  return { byId, byName };
}

function parseGameMode(gameMode) {
  const normalized = String(gameMode || '').toLowerCase();
  const perspective = normalized.includes('fpp') ? 'FPP' : 'TPP';
  let teamMode = 'UNKNOWN';

  if (normalized.includes('solo')) teamMode = 'SOLO';
  if (normalized.includes('duo')) teamMode = 'DUO';
  if (normalized.includes('squad')) teamMode = 'SQUAD';

  return {
    raw: gameMode || 'unknown',
    teamMode,
    perspective
  };
}

function isChickenDinnerMode(attrs, modeInfo) {
  const mapName = String(attrs.mapName || '').toLowerCase();
  const gameMode = String(modeInfo.raw || '').toLowerCase();

  if (modeInfo.teamMode === 'UNKNOWN') return false;
  if (mapName.includes('tdm')) return false;
  if (gameMode.includes('tdm') || gameMode.includes('deathmatch')) return false;

  return true;
}

function resolveMatchType(attrs, modeInfo) {
  const gameMode = String(modeInfo.raw || '').toLowerCase();
  const matchType = String(attrs.matchType || '').toLowerCase();

  if (attrs.isCustomMatch || matchType.includes('custom') || gameMode.includes('custom')) {
    return 'Custom';
  }

  if (matchType.includes('arcade') || gameMode.includes('arcade')) {
    return 'Arcade';
  }

  if (
    gameMode.includes('ranked') ||
    gameMode.includes('competitive') ||
    matchType.includes('ranked') ||
    matchType.includes('competitive')
  ) {
    return 'Ranked';
  }

  if (gameMode.includes('casual') || matchType.includes('casual')) {
    return 'Swobodny';
  }

  return 'Normalny';
}

function extractChickenDinner(matchData, matchId, trackedIndexes) {
  const attrs = matchData.data?.attributes || {};
  const modeInfo = parseGameMode(attrs.gameMode);
  if (!isChickenDinnerMode(attrs, modeInfo)) return null;

  const included = matchData?.included || [];
  const participants = included.filter(item => item.type === 'participant');
  const rosters = included.filter(item => item.type === 'roster');
  const participantById = new Map(participants.map(participant => [participant.id, participant]));
  const winningRoster = rosters.find(roster => Number(roster.attributes?.stats?.rank) === 1);

  if (!winningRoster) return null;

  const winnerParticipants = (winningRoster.relationships?.participants?.data || [])
    .map(ref => participantById.get(ref.id))
    .filter(Boolean);

  const winners = winnerParticipants.map(participant => {
    const stats = participant.attributes?.stats || {};
    const tracked =
      trackedIndexes.byId.get(stats.playerId) ||
      trackedIndexes.byName.get(normalizeName(stats.name));

    return {
      name: stats.name || 'Unknown',
      playerId: stats.playerId || null,
      kills: Number(stats.kills || 0),
      assists: Number(stats.assists || 0),
      damage: Math.round(Number(stats.damageDealt || 0)),
      avatarUrl: tracked?.avatarUrl || null,
      displayName: tracked?.displayName || stats.name || 'Unknown',
      clanTag: normalizeClanTag(
        stats.clanTag ||
        stats.clanName ||
        tracked?.clanTag
      ),
      isClanMember: Boolean(tracked)
    };
  });

  const clanWinners = winners.filter(player => player.isClanMember);
  if (!clanWinners.length) return null;

  const mapName = mapLabels[attrs.mapName] || attrs.mapName || 'Nieznana mapa';
  const matchTypeLabel = resolveMatchType(attrs, modeInfo);
  const createdAt = attrs.createdAt || null;
  const durationSeconds = Number(attrs.duration || 0);
  const createdAtTime = createdAt ? new Date(createdAt).getTime() : NaN;
  const endedAt = Number.isFinite(createdAtTime) && durationSeconds > 0
    ? new Date(createdAtTime + durationSeconds * 1000).toISOString()
    : null;

  return {
    matchId,
    mapName,
    createdAt,
    endedAt,
    modeInfo,
    matchTypeLabel,
    winners,
    clanWinners
  };
}

async function enrichWinnerClanTags(dinner, requestDelay, maxRequests) {
  const names = [...new Set(dinner.winners.map(player => player.name).filter(Boolean))];
  if (!names.length || maxRequests < 2) return { dinner, requestsUsed: 0 };

  let requestsUsed = 0;
  if (requestDelay > 0) await delay(requestDelay);
  requestsUsed += 1;
  const playerData = await getPlayersByNames(names);
  const clanIdByName = new Map();
  const uniqueClanIds = new Set();

  for (const player of playerData) {
    const name = player.attributes?.name;
    const clanId = player.attributes?.clanId;
    if (!name || !clanId) continue;
    clanIdByName.set(normalizeName(name), clanId);
    uniqueClanIds.add(clanId);
  }

  const clanTagById = new Map();
  for (const clanId of uniqueClanIds) {
    if (requestsUsed >= maxRequests) break;
    if (requestDelay > 0) await delay(requestDelay);
    requestsUsed += 1;
    const clan = await fetchClan(clanId);
    const attrs = clan?.data?.attributes || {};
    const clanTag = normalizeClanTag(attrs.clanTag || attrs.clanName);
    if (clanTag) clanTagById.set(clanId, clanTag);
  }

  const winners = dinner.winners.map(player => {
    const clanId = clanIdByName.get(normalizeName(player.name)) || null;
    const clanTag = clanId ? clanTagById.get(clanId) : '';

    return {
      ...player,
      clanId: clanId || player.clanId || null,
      clanTag: normalizeClanTag(clanTag || player.clanTag)
    };
  });

  return {
    dinner: {
      ...dinner,
      winners,
      clanWinners: winners.filter(player => player.isClanMember)
    },
    requestsUsed
  };
}

function shortenText(ctx, text, maxWidth) {
  const value = String(text || '');
  if (ctx.measureText(value).width <= maxWidth) return value;

  let shortened = value;
  while (shortened.length > 1 && ctx.measureText(`${shortened}...`).width > maxWidth) {
    shortened = shortened.slice(0, -1);
  }

  return `${shortened}...`;
}

function selectDisplayedWinners(winners) {
  return [...winners]
    .sort((a, b) => Number(b.isClanMember) - Number(a.isClanMember))
    .slice(0, 4);
}

function roundRect(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);

  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
  ctx.arcTo(x, y + height, x, y, safeRadius);
  ctx.arcTo(x, y, x + width, y, safeRadius);
  ctx.closePath();
}

function drawBackground(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#1c1f1b');
  gradient.addColorStop(0.55, '#10120f');
  gradient.addColorStop(1, '#242015');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(246, 181, 56, 0.16)';
  ctx.lineWidth = 2;

  for (let i = 0; i < 5; i += 1) {
    const x = 80 + i * 250;
    ctx.beginPath();
    ctx.moveTo(x, 120);
    ctx.lineTo(x + 60, 240);
    ctx.lineTo(x + 10, 390);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(246, 181, 56, 0.08)';
  ctx.beginPath();
  ctx.arc(width - 120, height - 80, 180, 0, Math.PI * 2);
  ctx.fill();
}

function drawFallbackAvatar(ctx, x, y, size, name) {
  const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, '#f6b538');
  gradient.addColorStop(1, '#6f4d08');

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#111111';
  ctx.font = 'bold 25px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(name || '?').slice(0, 2).toUpperCase(), x + size / 2, y + size / 2 + 1);
}

function drawTaggedPlayerName(ctx, player, x, baselineY, maxWidth) {
  const clanTag = normalizeClanTag(player.clanTag);

  if (!clanTag) {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(shortenText(ctx, player.name, maxWidth), x, baselineY);
    return;
  }

  ctx.font = 'bold 22px sans-serif';
  const prefix = `[${clanTag}] `;
  const prefixWidth = ctx.measureText(prefix).width;

  ctx.fillStyle = player.isClanMember ? '#f6b538' : '#cfcfcf';
  ctx.fillText(prefix, x, baselineY);

  ctx.fillStyle = '#ffffff';
  ctx.fillText(shortenText(ctx, player.name, maxWidth - prefixWidth), x + prefixWidth, baselineY);
}

async function drawAvatar(ctx, loadImageImpl, player, x, y, size) {
  if (!player.avatarUrl) {
    drawFallbackAvatar(ctx, x, y, size, player.name);
    return;
  }

  try {
    const image = await loadImageImpl(player.avatarUrl);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(image, x, y, size, size);
    ctx.restore();
  } catch {
    drawFallbackAvatar(ctx, x, y, size, player.name);
  }
}

async function renderChickenImage(dinner) {
  const { createCanvas, loadImage } = require('canvas');
  const width = DEFAULT_IMAGE_WIDTH;
  const height = 580;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  drawBackground(ctx, width, height);

  ctx.fillStyle = 'rgba(9, 10, 8, 0.72)';
  roundRect(ctx, 26, 26, width - 52, height - 52, 16);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 33px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('KURCZAK WYGRANY!', 70, 84);

  ctx.fillStyle = '#f6b538';
  ctx.font = 'bold 21px sans-serif';
  ctx.fillText('LEGION', 70, 116);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${dinner.mapName} | ${dinner.modeInfo.teamMode} | ${dinner.modeInfo.perspective}`, width - 70, 82);

  ctx.fillStyle = '#b8b8b8';
  ctx.font = '16px sans-serif';
  ctx.fillText(dinner.matchTypeLabel, width - 70, 108);

  const players = selectDisplayedWinners(dinner.winners);
  const avatarSize = 58;
  const startY = 150;
  const rowHeight = 78;
  const rowGap = 9;
  const rowX = 70;
  const rowWidth = width - 140;
  const nameX = rowX + 86;
  const statsStartX = width - 560;
  const statColumns = [
    { label: 'Zabojstwa', key: 'kills', x: statsStartX },
    { label: 'Obrazenia', key: 'damage', x: statsStartX + 185 },
    { label: 'Asysty', key: 'assists', x: statsStartX + 370 }
  ];

  ctx.textAlign = 'left';
  ctx.fillStyle = '#8f8f8f';
  ctx.font = 'bold 13px sans-serif';
  for (const column of statColumns) {
    ctx.fillText(column.label.toUpperCase(), column.x, startY - 12);
  }

  for (let index = 0; index < players.length; index += 1) {
    const player = players[index];
    const rowY = startY + index * (rowHeight + rowGap);
    const avatarX = rowX + 18;
    const avatarY = rowY + 10;

    ctx.fillStyle = player.isClanMember ? 'rgba(246, 181, 56, 0.13)' : 'rgba(255, 255, 255, 0.055)';
    roundRect(ctx, rowX, rowY, rowWidth, rowHeight, 12);
    ctx.fill();

    if (player.isClanMember) {
      ctx.strokeStyle = 'rgba(246, 181, 56, 0.7)';
      ctx.lineWidth = 2;
      roundRect(ctx, rowX, rowY, rowWidth, rowHeight, 12);
      ctx.stroke();
    }

    await drawAvatar(ctx, loadImage, player, avatarX, avatarY, avatarSize);

    if (player.isClanMember) {
      ctx.strokeStyle = '#f6b538';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.textAlign = 'left';
    drawTaggedPlayerName(ctx, player, nameX, rowY + 47, 350);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    ctx.textBaseline = 'middle';
    for (const column of statColumns) {
      ctx.fillText(String(player[column.key] ?? 0), column.x, rowY + rowHeight / 2 + 3);
    }
    ctx.textBaseline = 'alphabetic';
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#8d8d8d';
  ctx.font = '14px sans-serif';
  ctx.fillText('Sentinel PUBG Monitor', width / 2, height - 52);

  return canvas.toBuffer('image/png');
}

async function resolveGuildChickenChannel(guild) {
  if (config.pubg.chickenChannelId) {
    const byId =
      guild.channels.cache.get(config.pubg.chickenChannelId) ||
      await guild.channels.fetch(config.pubg.chickenChannelId).catch(() => null);

    if (byId?.isTextBased()) return byId;
  }

  const channelNames = [
    config.pubg.chickenChannelName,
    config.clan.statsChannelName
  ].filter(Boolean);

  for (const name of channelNames) {
    const byName = guild.channels.cache.find(channel => channel.name === name && channel.isTextBased());
    if (byName) return byName;
  }

  return null;
}

async function resolveChickenChannels(client) {
  const channels = [];
  const seen = new Set();

  for (const guild of client.guilds.cache.values()) {
    const channel = await resolveGuildChickenChannel(guild);
    if (!channel || seen.has(channel.id)) continue;
    seen.add(channel.id);
    channels.push(channel);
  }

  return channels;
}

async function sendChickenDinner(channels, dinner) {
  const fileName = `legion-chicken-${dinner.matchId.replace(/[^a-zA-Z0-9_-]/g, '')}.png`;
  const imageBuffer = await renderChickenImage(dinner);
  let sent = false;

  for (const channel of channels) {
    try {
      await channel.send({
        files: [new AttachmentBuilder(imageBuffer, { name: fileName })],
        allowedMentions: { parse: [] }
      });
      sent = true;
    } catch (error) {
      console.error(`[pubgChickenDinners] Blad wysylki na kanal ${channel.id}: ${error.message}`);
    }
  }

  return sent;
}

async function checkChickenDinners(client) {
  if (!config.pubg.apiKey) {
    if (!missingApiWarned) {
      console.warn('[pubgChickenDinners] Pomijam monitor: brakuje PUBG_API_KEY.');
      missingApiWarned = true;
    }
    return;
  }

  const channels = await resolveChickenChannels(client);
  if (!channels.length) {
    if (!missingChannelWarned) {
      console.warn('[pubgChickenDinners] Pomijam monitor: nie znaleziono kanalu docelowego.');
      missingChannelWarned = true;
    }
    return;
  }

  const state = loadChickenState();
  const firstRun = !state.initializedAt;
  const maxRequests = Math.max(1, config.pubg.chickenMaxRequestsPerRun || 8);
  let collected;

  try {
    collected = await collectRecentMatchIds(maxRequests);
  } catch (error) {
    if (isRateLimitError(error)) {
      console.warn(
        `[pubgChickenDinners] Limit PUBG API przy pobieraniu graczy. ` +
        `Retry-After: ${error.retryAfter || 'brak'}`
      );
      return;
    }
    throw error;
  }

  const { resolvedPlayers, matchIds, requestsUsed } = collected;

  if (!resolvedPlayers.length) return;

  if (firstRun && !config.pubg.chickenAnnounceOnFirstRun) {
    saveChickenState({
      ...state,
      initializedAt: new Date().toISOString(),
      seenMatchIds: [...state.seenMatchIds, ...matchIds],
      pendingMatchIds: []
    });
    console.log(`[pubgChickenDinners] Uzbrojono monitor, zapisano ${matchIds.length} ostatnich meczow bez wysylki.`);
    return;
  }

  const trackedIndexes = buildTrackedIndexes(resolvedPlayers);
  const seenOrAnnounced = new Set([
    ...state.seenMatchIds,
    ...state.announcedMatchIds
  ]);
  const pendingMatchIds = uniqueIds([
    ...state.pendingMatchIds,
    ...matchIds.filter(matchId => !seenOrAnnounced.has(matchId))
  ]).filter(matchId => !seenOrAnnounced.has(matchId));
  const remainingRequestBudget = Math.max(0, maxRequests - requestsUsed);
  const requestDelay = Math.max(0, config.pubg.chickenRequestDelayMs || 0);
  const nonDinnerMatchIds = [];
  const dinners = [];
  let requestsUsedTotal = requestsUsed;
  let remainingPendingMatchIds = [];

  if (!pendingMatchIds.length) {
    saveChickenState({
      ...state,
      initializedAt: state.initializedAt || new Date().toISOString(),
      pendingMatchIds: []
    });
    return;
  }

  if (remainingRequestBudget <= 0) {
    saveChickenState({
      ...state,
      initializedAt: state.initializedAt || new Date().toISOString(),
      pendingMatchIds
    });
    console.log(
      `[pubgChickenDinners] Wykorzystano budzet requestow na graczy. ` +
      `Mecze w kolejce: ${pendingMatchIds.length}.`
    );
    return;
  }

  const matchIdsToProcess = pendingMatchIds.slice(0, remainingRequestBudget);
  remainingPendingMatchIds = pendingMatchIds.slice(remainingRequestBudget);

  for (let index = 0; index < matchIdsToProcess.length; index += 1) {
    const matchId = matchIdsToProcess[index];
    if (requestsUsedTotal >= maxRequests) {
      remainingPendingMatchIds = uniqueIds([
        matchId,
        ...matchIdsToProcess.slice(index + 1),
        ...remainingPendingMatchIds
      ]);
      break;
    }

    if (requestsUsedTotal > 0 && requestDelay > 0) await delay(requestDelay);

    try {
      requestsUsedTotal += 1;
      const matchData = await fetchMatch(matchId);
      if (!matchData) {
        nonDinnerMatchIds.push(matchId);
        continue;
      }

      const dinner = extractChickenDinner(matchData, matchId, trackedIndexes);
      if (dinner) {
        try {
          const clanTagBudget = Math.max(0, maxRequests - requestsUsedTotal);
          const enriched = await enrichWinnerClanTags(dinner, requestDelay, clanTagBudget);
          requestsUsedTotal += enriched.requestsUsed;
          dinners.push(enriched.dinner);
        } catch (error) {
          if (isRateLimitError(error)) {
            console.warn(
              `[pubgChickenDinners] Limit PUBG API przy pobieraniu tagow klanow. ` +
              `Wysylam grafike bez pelnych tagow. Retry-After: ${error.retryAfter || 'brak'}`
            );
            dinners.push(dinner);
          } else {
            console.error(`[pubgChickenDinners] Blad pobierania tagow klanow ${matchId}: ${error.message}`);
            dinners.push(dinner);
          }
        }
      } else {
        nonDinnerMatchIds.push(matchId);
      }
    } catch (error) {
      if (isRateLimitError(error)) {
        remainingPendingMatchIds = uniqueIds([
          matchId,
          ...matchIdsToProcess.slice(index + 1),
          ...remainingPendingMatchIds
        ]);
        console.warn(
          `[pubgChickenDinners] Limit PUBG API przy meczu ${matchId}. ` +
          `Zostawiam ${remainingPendingMatchIds.length} meczow w kolejce. ` +
          `Retry-After: ${error.retryAfter || 'brak'}`
        );
        break;
      }

      remainingPendingMatchIds = uniqueIds([
        ...remainingPendingMatchIds,
        matchId
      ]);
      console.error(`[pubgChickenDinners] Blad meczu ${matchId}: ${error.message}`);
    }
  }

  dinners.sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return aTime - bTime;
  });

  const announcedNow = [];
  for (const dinner of dinners) {
    try {
      const sent = await sendChickenDinner(channels, dinner);
      if (sent) {
        announcedNow.push(dinner.matchId);
      } else {
        remainingPendingMatchIds.push(dinner.matchId);
      }
    } catch (error) {
      remainingPendingMatchIds.push(dinner.matchId);
      console.error(`[pubgChickenDinners] Blad renderu/wysylki ${dinner.matchId}: ${error.message}`);
    }
  }

  saveChickenState({
    ...state,
    initializedAt: state.initializedAt || new Date().toISOString(),
    seenMatchIds: [...state.seenMatchIds, ...nonDinnerMatchIds, ...announcedNow],
    announcedMatchIds: [...state.announcedMatchIds, ...announcedNow],
    pendingMatchIds: remainingPendingMatchIds
  });
}

async function runChickenCheck(client) {
  if (checkInProgress) return;
  checkInProgress = true;

  try {
    await checkChickenDinners(client);
  } catch (error) {
    console.error('[pubgChickenDinners] Blad monitora:', error.message);
  } finally {
    checkInProgress = false;
  }
}

function setupPubgChickenDinners(client) {
  const intervalMs = Math.max(MIN_CHECK_INTERVAL_MS, config.pubg.chickenCheckMs || MIN_CHECK_INTERVAL_MS);

  client.once('clientReady', () => {
    runChickenCheck(client);
    setInterval(() => runChickenCheck(client), intervalMs);
  });
}

module.exports = {
  setupPubgChickenDinners,
  checkChickenDinners,
  renderChickenImage
};
