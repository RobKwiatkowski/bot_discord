// Lekkie statystyki aktywnosci Discorda: liczniki wiadomosci i czasu voice.
// Modul nie zapisuje tresci wiadomosci, tylko agregaty per dzien/uzytkownik/kanal.
const { ActivityType } = require('discord.js');
const { config } = require('../config');
const { readJson, writeJson } = require('../jsonStore');

const EMPTY_HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));
const DEFAULT_PERIOD = '7d';
const STATS_VERSION = 3;
const PROFILE_CHANNEL_LIMIT = 5;
const GAME_ACTIVITY_TYPES = new Set([ActivityType.Playing]);
const MAX_SESSION_CHUNK_MS = 5 * 60 * 1000;
const PERIODS = {
  today: { label: 'Dzisiaj', days: 1 },
  '7d': { label: 'Ostatnie 7 dni', days: 7 },
  '30d': { label: 'Ostatnie 30 dni', days: 30 },
  all: { label: 'Caly zapisany okres', days: null }
};

let memoryData = null;
let dirty = false;
let lastMissingEndpointWarning = 0;
let lastInvitePermissionWarning = 0;
const inviteCacheByGuild = new Map();

function emptyStatsData() {
  return {
    version: STATS_VERSION,
    users: {},
    days: {},
    activeVoiceSessions: {},
    activeGameSessions: {},
    updatedAt: null,
    lastSyncAt: null
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadStatsData() {
  if (!memoryData) {
    memoryData = normalizeStatsData(readJson(config.files.discordStats, emptyStatsData()));
  }

  return memoryData;
}

function readStatsDataForSummary() {
  return normalizeStatsData(readJson(config.files.discordStats, emptyStatsData()));
}

function normalizeStatsData(data) {
  const normalized = data && typeof data === 'object' ? data : emptyStatsData();
  normalized.version = STATS_VERSION;
  normalized.users = normalized.users && typeof normalized.users === 'object' ? normalized.users : {};
  normalized.days = normalized.days && typeof normalized.days === 'object' ? normalized.days : {};
  normalized.activeVoiceSessions =
    normalized.activeVoiceSessions && typeof normalized.activeVoiceSessions === 'object'
      ? normalized.activeVoiceSessions
      : {};
  normalized.activeGameSessions =
    normalized.activeGameSessions && typeof normalized.activeGameSessions === 'object'
      ? normalized.activeGameSessions
      : {};

  return normalized;
}

function markDirty() {
  dirty = true;
  const data = loadStatsData();
  data.updatedAt = new Date().toISOString();
}

function flushStats(force = false) {
  if (!force && !dirty) return;
  writeJson(config.files.discordStats, loadStatsData());
  dirty = false;
}

function numberValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function isoTime(ms) {
  return new Date(ms).toISOString();
}

function latestIso(...values) {
  let latest = '';
  let latestMs = 0;

  for (const value of values) {
    const ms = Date.parse(value || '');
    if (Number.isFinite(ms) && ms > latestMs) {
      latestMs = ms;
      latest = value;
    }
  }

  return latest;
}

function updateUserIndex(data, user, activityType, activityMs = Date.now()) {
  if (!user?.id) return null;

  const current = data.users[user.id] || {
    id: user.id,
    username: '',
    displayName: '',
    avatarUrl: '',
    lastMessageAt: '',
    lastVoiceAt: '',
    lastGameAt: '',
    lastInviteAt: '',
    lastActiveAt: ''
  };
  const activityAt = isoTime(activityMs);

  current.username = user.username || current.username || user.id;
  current.displayName = user.displayName || current.displayName || current.username || user.id;
  current.avatarUrl = user.avatarUrl || current.avatarUrl || '';

  if (activityType === 'message') {
    current.lastMessageAt = latestIso(current.lastMessageAt, activityAt);
  }
  if (activityType === 'voice') {
    current.lastVoiceAt = latestIso(current.lastVoiceAt, activityAt);
  }
  if (activityType === 'game') {
    current.lastGameAt = latestIso(current.lastGameAt, activityAt);
  }
  if (activityType === 'invite') {
    current.lastInviteAt = latestIso(current.lastInviteAt, activityAt);
  }
  current.lastActiveAt = latestIso(
    current.lastActiveAt,
    activityAt,
    current.lastMessageAt,
    current.lastVoiceAt,
    current.lastGameAt
  );

  data.users[user.id] = current;
  return current;
}

function partsForTime(ms) {
  const date = new Date(ms);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.discordStats.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  });

  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parts.hour || '00'
  };
}

function dateKeyForTime(ms) {
  return partsForTime(ms).dateKey;
}

function recentDateKeys(days, nowMs = Date.now()) {
  if (!days) {
    return Object.keys(loadStatsData().days).sort();
  }

  const keys = [];
  const seen = new Set();
  for (let offset = 0; keys.length < days && offset < days + 3; offset++) {
    const key = dateKeyForTime(nowMs - offset * 24 * 60 * 60 * 1000);
    if (!seen.has(key)) {
      keys.push(key);
      seen.add(key);
    }
  }

  return keys.sort();
}

function emptyDay() {
  return {
    totalMessages: 0,
    totalVoiceSeconds: 0,
    totalGameSeconds: 0,
    messages: {
      byUser: {},
      byChannel: {},
      byHour: {}
    },
    voice: {
      byUser: {},
      byChannel: {},
      byHour: {}
    },
    games: {
      byUser: {},
      byGame: {},
      byHour: {}
    },
    invites: {
      total: 0,
      unknown: 0,
      byInviter: {},
      byHour: {}
    },
    members: {
      joined: 0,
      left: 0,
      byHour: {}
    }
  };
}

function getDay(data, dateKey) {
  if (!data.days[dateKey]) data.days[dateKey] = emptyDay();
  const day = data.days[dateKey];
  day.totalMessages = numberValue(day.totalMessages);
  day.totalVoiceSeconds = numberValue(day.totalVoiceSeconds);
  day.totalGameSeconds = numberValue(day.totalGameSeconds);
  day.messages = day.messages || {};
  day.messages.byUser = day.messages.byUser || {};
  day.messages.byChannel = day.messages.byChannel || {};
  day.messages.byHour = day.messages.byHour || {};
  day.voice = day.voice || {};
  day.voice.byUser = day.voice.byUser || {};
  day.voice.byChannel = day.voice.byChannel || {};
  day.voice.byHour = day.voice.byHour || {};
  day.games = day.games || {};
  day.games.byUser = day.games.byUser || {};
  day.games.byGame = day.games.byGame || {};
  day.games.byHour = day.games.byHour || {};
  day.invites = day.invites || {};
  day.invites.total = numberValue(day.invites.total);
  day.invites.unknown = numberValue(day.invites.unknown);
  day.invites.byInviter = day.invites.byInviter || {};
  day.invites.byHour = day.invites.byHour || {};
  day.members = day.members || {};
  day.members.joined = numberValue(day.members.joined);
  day.members.left = numberValue(day.members.left);
  day.members.byHour = day.members.byHour || {};
  return day;
}

function shouldIgnoreUser(user) {
  if (!user) return true;
  if (!config.discordStats.includeBots && user.bot) return true;
  return isIgnoredUserId(user.id);
}

function isIgnoredUserId(userId) {
  return Boolean(userId && config.discordStats.ignoredUserIds.includes(userId));
}

function isIgnoredChannelId(channelId) {
  return Boolean(channelId && config.discordStats.ignoredChannelIds.includes(channelId));
}

function shouldIgnoreChannel(channel) {
  if (!channel) return true;
  if (isIgnoredChannelId(channel.id)) return true;
  return channel.parentId && config.discordStats.ignoredCategoryIds.includes(channel.parentId);
}

function userInfoFromMessage(message) {
  const user = message.author;
  return {
    id: user.id,
    username: user.username || user.tag || user.id,
    displayName: message.member?.displayName || user.globalName || user.username || user.id,
    avatarUrl: typeof user.displayAvatarURL === 'function'
      ? user.displayAvatarURL({ extension: 'png', size: 64 })
      : ''
  };
}

function userInfoFromMember(member) {
  const user = member?.user;
  return {
    id: user?.id || member?.id || '',
    username: user?.username || user?.tag || member?.id || '',
    displayName: member?.displayName || user?.globalName || user?.username || member?.id || '',
    avatarUrl: typeof user?.displayAvatarURL === 'function'
      ? user.displayAvatarURL({ extension: 'png', size: 64 })
      : ''
  };
}

function userInfoFromUser(user, member = null) {
  return {
    id: user?.id || member?.id || '',
    username: user?.username || user?.tag || member?.id || '',
    displayName: member?.displayName || user?.globalName || user?.username || member?.id || '',
    avatarUrl: typeof user?.displayAvatarURL === 'function'
      ? user.displayAvatarURL({ extension: 'png', size: 64 })
      : ''
  };
}

function userInfoFromPresence(presence) {
  if (presence?.member) return userInfoFromMember(presence.member);
  const info = userInfoFromUser(presence?.user);
  if (!info.id && presence?.userId) {
    info.id = presence.userId;
    info.username = presence.userId;
    info.displayName = presence.userId;
  }
  return info;
}

function bumpChannelMetric(channels, channelId, channelName, valueField, amount, countSession = false) {
  if (!channelId) return;

  const channelEntry = channels[channelId] || {
    id: channelId,
    name: channelName || 'Nieznany kanal',
    count: 0,
    seconds: 0,
    sessions: 0
  };
  channelEntry.name = channelName || channelEntry.name;
  channelEntry[valueField] = numberValue(channelEntry[valueField]) + amount;
  if (countSession) {
    channelEntry.sessions = numberValue(channelEntry.sessions) + 1;
  }
  channels[channelId] = channelEntry;
}

function bumpMessage(message) {
  const data = loadStatsData();
  const nowMs = message.createdTimestamp || Date.now();
  const { dateKey, hour } = partsForTime(nowMs);
  const day = getDay(data, dateKey);
  const user = userInfoFromMessage(message);
  const channel = message.channel;
  const channelId = channel?.id || 'unknown';
  const channelName = channel?.name || 'Nieznany kanal';

  day.totalMessages += 1;
  day.messages.byHour[hour] = numberValue(day.messages.byHour[hour]) + 1;

  const userEntry = day.messages.byUser[user.id] || {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    count: 0
  };
  userEntry.username = user.username || userEntry.username;
  userEntry.displayName = user.displayName || userEntry.displayName;
  userEntry.avatarUrl = user.avatarUrl || userEntry.avatarUrl;
  userEntry.channels = userEntry.channels && typeof userEntry.channels === 'object' ? userEntry.channels : {};
  userEntry.count = numberValue(userEntry.count) + 1;
  userEntry.lastMessageAt = latestIso(userEntry.lastMessageAt, isoTime(nowMs));
  userEntry.lastActiveAt = latestIso(userEntry.lastActiveAt, userEntry.lastMessageAt);
  bumpChannelMetric(userEntry.channels, channelId, channelName, 'count', 1);
  day.messages.byUser[user.id] = userEntry;

  const channelEntry = day.messages.byChannel[channelId] || {
    id: channelId,
    name: channelName,
    count: 0
  };
  channelEntry.name = channelName || channelEntry.name;
  channelEntry.count = numberValue(channelEntry.count) + 1;
  day.messages.byChannel[channelId] = channelEntry;

  updateUserIndex(data, user, 'message', nowMs);
  markDirty();
}

function bumpMemberEvent(type, timestampMs = Date.now()) {
  const data = loadStatsData();
  const { dateKey, hour } = partsForTime(timestampMs);
  const day = getDay(data, dateKey);
  const field = type === 'left' ? 'left' : 'joined';

  day.members[field] = numberValue(day.members[field]) + 1;
  const hourEntry = day.members.byHour[hour] || { joined: 0, left: 0 };
  hourEntry[field] = numberValue(hourEntry[field]) + 1;
  day.members.byHour[hour] = hourEntry;
  markDirty();
}

function sessionKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function startVoiceSession(data, state, nowMs = Date.now()) {
  const member = state.member;
  const user = userInfoFromMember(member);
  if (!user.id || shouldIgnoreUser(member?.user) || shouldIgnoreChannel(state.channel)) return;

  updateUserIndex(data, user, 'voice', nowMs);
  data.activeVoiceSessions[sessionKey(state.guild.id, user.id)] = {
    guildId: state.guild.id,
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    channelId: state.channel.id,
    channelName: state.channel.name || 'Kanal glosowy',
    startedAt: new Date(nowMs).toISOString()
  };
}

function addVoiceDuration(data, session, startMs, endMs, countSession = true) {
  if (!session || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;

  updateUserIndex(
    data,
    {
      id: session.userId,
      username: session.username,
      displayName: session.displayName,
      avatarUrl: session.avatarUrl
    },
    'voice',
    endMs
  );

  let cursor = startMs;
  let countedSession = !countSession;

  while (cursor < endMs) {
    const chunkEnd = Math.min(endMs, cursor + MAX_SESSION_CHUNK_MS);
    const seconds = Math.max(0, Math.round((chunkEnd - cursor) / 1000));
    if (seconds <= 0) break;

    const { dateKey, hour } = partsForTime(cursor);
    const day = getDay(data, dateKey);

    day.totalVoiceSeconds += seconds;
    day.voice.byHour[hour] = numberValue(day.voice.byHour[hour]) + seconds;

    const userEntry = day.voice.byUser[session.userId] || {
      id: session.userId,
      username: session.username,
      displayName: session.displayName,
      avatarUrl: session.avatarUrl,
      seconds: 0,
      sessions: 0
    };
    userEntry.username = session.username || userEntry.username;
    userEntry.displayName = session.displayName || userEntry.displayName;
    userEntry.avatarUrl = session.avatarUrl || userEntry.avatarUrl;
    userEntry.channels = userEntry.channels && typeof userEntry.channels === 'object' ? userEntry.channels : {};
    userEntry.seconds = numberValue(userEntry.seconds) + seconds;
    if (!countedSession) {
      userEntry.sessions = numberValue(userEntry.sessions) + 1;
    }
    userEntry.lastVoiceAt = latestIso(userEntry.lastVoiceAt, isoTime(chunkEnd));
    userEntry.lastActiveAt = latestIso(userEntry.lastActiveAt, userEntry.lastVoiceAt);
    bumpChannelMetric(userEntry.channels, session.channelId, session.channelName, 'seconds', seconds, !countedSession);
    day.voice.byUser[session.userId] = userEntry;

    const channelEntry = day.voice.byChannel[session.channelId] || {
      id: session.channelId,
      name: session.channelName,
      seconds: 0,
      sessions: 0
    };
    channelEntry.name = session.channelName || channelEntry.name;
    channelEntry.seconds = numberValue(channelEntry.seconds) + seconds;
    if (!countedSession) {
      channelEntry.sessions = numberValue(channelEntry.sessions) + 1;
    }
    day.voice.byChannel[session.channelId] = channelEntry;

    countedSession = true;
    cursor = chunkEnd;
  }
}

function closeVoiceSession(data, guildId, userId, nowMs = Date.now()) {
  const key = sessionKey(guildId, userId);
  const session = data.activeVoiceSessions[key];
  if (!session) return;

  const startedMs = Date.parse(session.startedAt);
  addVoiceDuration(data, session, startedMs, nowMs, true);
  delete data.activeVoiceSessions[key];
}

function handleVoiceState(oldState, newState) {
  const oldChannelId = oldState.channelId;
  const newChannelId = newState.channelId;
  if (oldChannelId === newChannelId) return;

  const member = newState.member || oldState.member;
  const user = member?.user;
  if (!user || shouldIgnoreUser(user)) return;

  const data = loadStatsData();
  const nowMs = Date.now();

  if (oldState.channel && !shouldIgnoreChannel(oldState.channel)) {
    closeVoiceSession(data, oldState.guild.id, user.id, nowMs);
  }

  if (newState.channel && !shouldIgnoreChannel(newState.channel)) {
    startVoiceSession(data, newState, nowMs);
  }

  markDirty();
}

function normalizeGameName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function gameKeyForName(name) {
  const normalized = normalizeGameName(name);
  return normalized ? normalized.toLocaleLowerCase('pl-PL') : '';
}

function gameSessionKey(guildId, userId, gameKey) {
  return `${guildId}:${userId}:${gameKey}`;
}

function isGameActivity(activity) {
  if (!activity || !GAME_ACTIVITY_TYPES.has(activity.type)) return false;
  return normalizeGameName(activity.name) !== '';
}

function gamesFromPresence(presence) {
  const games = new Map();
  for (const activity of presence?.activities || []) {
    if (!isGameActivity(activity)) continue;
    const name = normalizeGameName(activity.name);
    const key = gameKeyForName(name);
    if (key) {
      games.set(key, { key, name });
    }
  }
  return games;
}

function shouldIgnorePresence(presence) {
  const user = presence?.user || presence?.member?.user;
  if (user) return shouldIgnoreUser(user);
  return isIgnoredUserId(presence?.userId);
}

function startGameSession(data, presence, game, nowMs = Date.now()) {
  const user = userInfoFromPresence(presence);
  if (!presence?.guild?.id || !user.id || shouldIgnorePresence(presence)) return false;

  updateUserIndex(data, user, 'game', nowMs);
  data.activeGameSessions[gameSessionKey(presence.guild.id, user.id, game.key)] = {
    guildId: presence.guild.id,
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    gameKey: game.key,
    gameName: game.name,
    startedAt: new Date(nowMs).toISOString()
  };
  return true;
}

function addGameDuration(data, session, startMs, endMs, countSession = true) {
  if (!session || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;

  updateUserIndex(
    data,
    {
      id: session.userId,
      username: session.username,
      displayName: session.displayName,
      avatarUrl: session.avatarUrl
    },
    'game',
    endMs
  );

  let cursor = startMs;
  let countedSession = !countSession;

  while (cursor < endMs) {
    const chunkEnd = Math.min(endMs, cursor + MAX_SESSION_CHUNK_MS);
    const seconds = Math.max(0, Math.round((chunkEnd - cursor) / 1000));
    if (seconds <= 0) break;

    const { dateKey, hour } = partsForTime(cursor);
    const day = getDay(data, dateKey);
    const gameId = session.gameKey || gameKeyForName(session.gameName);
    const gameName = session.gameName || 'Nieznana gra';

    day.totalGameSeconds += seconds;
    day.games.byHour[hour] = numberValue(day.games.byHour[hour]) + seconds;

    const userEntry = day.games.byUser[session.userId] || {
      id: session.userId,
      username: session.username,
      displayName: session.displayName,
      avatarUrl: session.avatarUrl,
      seconds: 0,
      sessions: 0,
      games: {}
    };
    userEntry.username = session.username || userEntry.username;
    userEntry.displayName = session.displayName || userEntry.displayName;
    userEntry.avatarUrl = session.avatarUrl || userEntry.avatarUrl;
    userEntry.games = userEntry.games && typeof userEntry.games === 'object' ? userEntry.games : {};
    userEntry.seconds = numberValue(userEntry.seconds) + seconds;
    if (!countedSession) {
      userEntry.sessions = numberValue(userEntry.sessions) + 1;
    }
    userEntry.lastGameAt = latestIso(userEntry.lastGameAt, isoTime(chunkEnd));
    userEntry.lastActiveAt = latestIso(userEntry.lastActiveAt, userEntry.lastGameAt);

    const userGame = userEntry.games[gameId] || {
      id: gameId,
      name: gameName,
      seconds: 0,
      sessions: 0
    };
    userGame.name = gameName || userGame.name;
    userGame.seconds = numberValue(userGame.seconds) + seconds;
    if (!countedSession) {
      userGame.sessions = numberValue(userGame.sessions) + 1;
    }
    userEntry.games[gameId] = userGame;
    day.games.byUser[session.userId] = userEntry;

    const gameEntry = day.games.byGame[gameId] || {
      id: gameId,
      name: gameName,
      seconds: 0,
      sessions: 0
    };
    gameEntry.name = gameName || gameEntry.name;
    gameEntry.seconds = numberValue(gameEntry.seconds) + seconds;
    if (!countedSession) {
      gameEntry.sessions = numberValue(gameEntry.sessions) + 1;
    }
    day.games.byGame[gameId] = gameEntry;

    countedSession = true;
    cursor = chunkEnd;
  }
}

function closeGameSessionByKey(data, key, nowMs = Date.now()) {
  const session = data.activeGameSessions[key];
  if (!session) return false;

  const startedMs = Date.parse(session.startedAt);
  addGameDuration(data, session, startedMs, nowMs, true);
  delete data.activeGameSessions[key];
  return true;
}

function handlePresenceUpdate(oldPresence, newPresence) {
  const presence = newPresence || oldPresence;
  const guildId = presence?.guild?.id;
  const userId = presence?.userId || presence?.user?.id || presence?.member?.id;
  if (!guildId || !userId) return;

  const data = loadStatsData();
  const nowMs = Date.now();
  const nextGames = shouldIgnorePresence(presence) ? new Map() : gamesFromPresence(newPresence);
  const currentKeys = Object.entries(data.activeGameSessions || {})
    .filter(([, session]) => session.guildId === guildId && session.userId === userId)
    .map(([key]) => key);
  let changed = false;

  for (const key of currentKeys) {
    const session = data.activeGameSessions[key];
    if (!nextGames.has(session.gameKey)) {
      changed = closeGameSessionByKey(data, key, nowMs) || changed;
    }
  }

  for (const [gameKey, game] of nextGames) {
    const key = gameSessionKey(guildId, userId, gameKey);
    if (!data.activeGameSessions[key]) {
      changed = startGameSession(data, newPresence, game, nowMs) || changed;
    }
  }

  if (changed) markDirty();
}

function pruneOldDays(data) {
  const retentionDays = Math.max(1, Number(config.discordStats.retentionDays || 365));
  const keep = new Set(recentDateKeys(retentionDays));
  let changed = false;

  for (const key of Object.keys(data.days)) {
    if (!keep.has(key)) {
      delete data.days[key];
      changed = true;
    }
  }

  if (changed) markDirty();
}

async function hydrateCurrentVoiceSessions(client) {
  const data = loadStatsData();
  data.activeVoiceSessions = {};
  const nowMs = Date.now();

  for (const guild of client.guilds.cache.values()) {
    for (const state of guild.voiceStates.cache.values()) {
      if (state.channel && state.member) {
        startVoiceSession(data, state, nowMs);
      }
    }
  }

  pruneOldDays(data);
  markDirty();
  flushStats(true);
}

async function hydrateCurrentGameSessions(client) {
  const data = loadStatsData();
  data.activeGameSessions = {};
  const nowMs = Date.now();

  for (const guild of client.guilds.cache.values()) {
    for (const presence of guild.presences.cache.values()) {
      if (shouldIgnorePresence(presence)) continue;

      for (const game of gamesFromPresence(presence).values()) {
        startGameSession(data, presence, game, nowMs);
      }
    }
  }

  markDirty();
  flushStats(true);
}

function inviteSnapshot(invites) {
  const snapshot = new Map();
  for (const invite of invites?.values?.() || []) {
    if (!invite?.code) continue;
    snapshot.set(invite.code, {
      code: invite.code,
      uses: numberValue(invite.uses),
      inviterId: invite.inviter?.id || ''
    });
  }
  return snapshot;
}

function warnInvitePermission(guildId, error) {
  const now = Date.now();
  if (now - lastInvitePermissionWarning < 60 * 60 * 1000) return;
  console.warn(`[discordStats] Nie moge pobrac invite'ow dla serwera ${guildId}: ${error.message}`);
  lastInvitePermissionWarning = now;
}

async function fetchGuildInvites(guild) {
  try {
    return await guild.invites.fetch();
  } catch (error) {
    warnInvitePermission(guild?.id || 'unknown', error);
    return null;
  }
}

async function refreshInviteCache(guild) {
  if (!guild) return null;
  const invites = await fetchGuildInvites(guild);
  if (!invites) return null;

  const snapshot = inviteSnapshot(invites);
  inviteCacheByGuild.set(guild.id, snapshot);
  return { invites, snapshot };
}

async function hydrateInviteCaches(client) {
  for (const guild of client.guilds.cache.values()) {
    await refreshInviteCache(guild);
  }
}

function bumpInviteUse(member, invite, timestampMs = Date.now()) {
  const data = loadStatsData();
  const { dateKey, hour } = partsForTime(timestampMs);
  const day = getDay(data, dateKey);

  day.invites.total = numberValue(day.invites.total) + 1;
  const hourEntry = day.invites.byHour[hour] || { total: 0, unknown: 0 };
  hourEntry.total = numberValue(hourEntry.total) + 1;

  const inviter = invite?.inviter;
  if (!inviter?.id || isIgnoredUserId(inviter.id)) {
    day.invites.unknown = numberValue(day.invites.unknown) + 1;
    hourEntry.unknown = numberValue(hourEntry.unknown) + 1;
    day.invites.byHour[hour] = hourEntry;
    markDirty();
    return;
  }

  const inviterInfo = userInfoFromUser(inviter);
  const entry = day.invites.byInviter[inviterInfo.id] || {
    id: inviterInfo.id,
    username: inviterInfo.username,
    displayName: inviterInfo.displayName,
    avatarUrl: inviterInfo.avatarUrl,
    count: 0,
    codes: {}
  };
  entry.username = inviterInfo.username || entry.username;
  entry.displayName = inviterInfo.displayName || entry.displayName;
  entry.avatarUrl = inviterInfo.avatarUrl || entry.avatarUrl;
  entry.count = numberValue(entry.count) + 1;
  entry.codes = entry.codes && typeof entry.codes === 'object' ? entry.codes : {};
  if (invite.code) {
    entry.codes[invite.code] = numberValue(entry.codes[invite.code]) + 1;
  }
  entry.lastInviteAt = latestIso(entry.lastInviteAt, isoTime(timestampMs));
  day.invites.byInviter[inviterInfo.id] = entry;
  day.invites.byHour[hour] = hourEntry;

  updateUserIndex(data, inviterInfo, 'invite', timestampMs);
  markDirty();
}

async function recordInviteUse(member) {
  const guild = member?.guild;
  if (!guild) {
    bumpInviteUse(member, null);
    return;
  }

  const previous = inviteCacheByGuild.get(guild.id) || new Map();
  const result = await refreshInviteCache(guild);
  if (!result) {
    bumpInviteUse(member, null);
    return;
  }

  let usedInvite = null;
  if (previous.size > 0) {
    for (const invite of result.invites.values()) {
      const before = previous.get(invite.code);
      if (numberValue(invite.uses) > numberValue(before?.uses)) {
        usedInvite = invite;
        break;
      }
    }
  }

  bumpInviteUse(member, usedInvite);
}

function mergeMap(target, source, valueField) {
  for (const item of Object.values(source || {})) {
    if (!item || !item.id || isIgnoredUserId(item.id)) continue;
    const current = target[item.id] || { ...item, [valueField]: 0, sessions: 0 };
    current.username = item.username || current.username;
    current.displayName = item.displayName || current.displayName;
    current.avatarUrl = item.avatarUrl || current.avatarUrl;
    current.name = item.name || current.name;
    current[valueField] = numberValue(current[valueField]) + numberValue(item[valueField]);
    if (Object.prototype.hasOwnProperty.call(item, 'sessions')) {
      current.sessions = numberValue(current.sessions) + numberValue(item.sessions);
    }
    target[item.id] = current;
  }
}

function channelGroupKey(item) {
  const name = String(item?.name || '').trim().replace(/\s+/g, ' ');
  if (name !== '') return `name:${name.toLocaleLowerCase('pl-PL')}`;
  return `id:${item?.id || 'unknown'}`;
}

function mergeChannelMap(target, source, valueField) {
  for (const item of Object.values(source || {})) {
    if (!item || !item.id || isIgnoredChannelId(item.id)) continue;

    const key = channelGroupKey(item);
    const current = target[key] || {
      id: item.id,
      name: item.name || 'Nieznany kanal',
      count: 0,
      seconds: 0,
      sessions: 0
    };
    current.name = item.name || current.name;
    current[valueField] = numberValue(current[valueField]) + numberValue(item[valueField]);
    current.sessions = numberValue(current.sessions) + numberValue(item.sessions);
    target[key] = current;
  }
}

function gameGroupKey(item) {
  const name = normalizeGameName(item?.name);
  if (name !== '') return `name:${name.toLocaleLowerCase('pl-PL')}`;
  return `id:${item?.id || 'unknown'}`;
}

function mergeGameMap(target, source, valueField = 'seconds') {
  for (const item of Object.values(source || {})) {
    if (!item || !item.id) continue;

    const key = gameGroupKey(item);
    const current = target[key] || {
      id: item.id,
      name: item.name || 'Nieznana gra',
      seconds: 0,
      sessions: 0
    };
    current.name = item.name || current.name;
    current[valueField] = numberValue(current[valueField]) + numberValue(item[valueField]);
    current.sessions = numberValue(current.sessions) + numberValue(item.sessions);
    target[key] = current;
  }
}

function filterChannelMap(source) {
  const result = {};
  for (const item of Object.values(source || {})) {
    if (!item || !item.id || isIgnoredChannelId(item.id)) continue;
    result[item.id] = item;
  }
  return result;
}

function subtractIgnoredUserChannels(channelMap, userMap, valueField) {
  const result = {};
  for (const item of Object.values(channelMap || {})) {
    if (!item || !item.id) continue;
    result[item.id] = { ...item };
  }

  for (const user of Object.values(userMap || {})) {
    if (!user || !isIgnoredUserId(user.id) || !user.channels || typeof user.channels !== 'object') continue;

    for (const channel of Object.values(user.channels)) {
      if (!channel?.id || !result[channel.id]) continue;
      result[channel.id][valueField] = Math.max(0, numberValue(result[channel.id][valueField]) - numberValue(channel[valueField]));
      if (Object.prototype.hasOwnProperty.call(result[channel.id], 'sessions')) {
        result[channel.id].sessions = Math.max(0, numberValue(result[channel.id].sessions) - numberValue(channel.sessions));
      }
      if (numberValue(result[channel.id][valueField]) <= 0) {
        delete result[channel.id];
      }
    }
  }

  return result;
}

function sumMap(map, valueField) {
  return Object.values(map || {}).reduce((sum, item) => sum + numberValue(item?.[valueField]), 0);
}

function filterUserMapByChannels(source, valueField) {
  const result = {};

  for (const item of Object.values(source || {})) {
    if (!item || !item.id || isIgnoredUserId(item.id)) continue;

    const channels = item.channels && typeof item.channels === 'object' ? item.channels : null;
    if (!channels || Object.keys(channels).length === 0) {
      result[item.id] = item;
      continue;
    }

    const filteredChannels = filterChannelMap(channels);
    const filteredValue = sumMap(filteredChannels, valueField);
    if (filteredValue <= 0) continue;

    const current = {
      ...item,
      channels: filteredChannels,
      [valueField]: filteredValue
    };
    if (Object.prototype.hasOwnProperty.call(item, 'sessions')) {
      current.sessions = sumMap(filteredChannels, 'sessions');
    }
    result[item.id] = current;
  }

  return result;
}

function mergeChannelBreakdown(target, source, valueField) {
  for (const item of Object.values(source || {})) {
    if (!item || !item.id || isIgnoredChannelId(item.id)) continue;

    const current = target[item.id] || {
      id: item.id,
      name: item.name || 'Nieznany kanal',
      count: 0,
      seconds: 0,
      sessions: 0
    };
    current.name = item.name || current.name;
    current[valueField] = numberValue(current[valueField]) + numberValue(item[valueField]);
    current.sessions = numberValue(current.sessions) + numberValue(item.sessions);
    target[item.id] = current;
  }
}

function ensureUserProfile(profiles, data, userId, item = {}) {
  if (!userId) return null;

  const indexed = data.users?.[userId] || {};
  const current = profiles[userId] || {
    id: userId,
    username: '',
    displayName: '',
    avatarUrl: '',
    messages: 0,
    voiceSeconds: 0,
    gameSeconds: 0,
    sessions: 0,
    gameSessions: 0,
    invites: 0,
    lastMessageAt: '',
    lastVoiceAt: '',
    lastGameAt: '',
    lastInviteAt: '',
    lastActiveAt: '',
    textChannels: {},
    voiceChannels: {},
    games: {}
  };

  current.username = indexed.username || item.username || current.username || userId;
  current.displayName = indexed.displayName || item.displayName || current.displayName || current.username || userId;
  current.avatarUrl = indexed.avatarUrl || item.avatarUrl || current.avatarUrl || '';
  current.lastMessageAt = latestIso(current.lastMessageAt, indexed.lastMessageAt, item.lastMessageAt);
  current.lastVoiceAt = latestIso(current.lastVoiceAt, indexed.lastVoiceAt, item.lastVoiceAt);
  current.lastGameAt = latestIso(current.lastGameAt, indexed.lastGameAt, item.lastGameAt);
  current.lastInviteAt = latestIso(current.lastInviteAt, indexed.lastInviteAt, item.lastInviteAt);
  current.lastActiveAt = latestIso(
    current.lastActiveAt,
    indexed.lastActiveAt,
    item.lastActiveAt,
    current.lastMessageAt,
    current.lastVoiceAt,
    current.lastGameAt
  );

  profiles[userId] = current;
  return current;
}

function topItems(map, valueField, limit) {
  return Object.values(map)
    .map(item => ({
      ...item,
      value: numberValue(item[valueField])
    }))
    .sort((a, b) => b.value - a.value || String(a.displayName || a.name || '').localeCompare(String(b.displayName || b.name || '')))
    .slice(0, limit);
}

function channelTopOutput(map, valueField, outputKey, limit = PROFILE_CHANNEL_LIMIT) {
  const grouped = {};
  mergeChannelMap(grouped, map, valueField);
  return topItems(grouped, valueField, limit).map(item => ({
    id: item.id,
    name: item.name,
    [outputKey]: item.value,
    sessions: numberValue(item.sessions),
    value: item.value
  }));
}

function gameTopOutput(map, limit = PROFILE_CHANNEL_LIMIT) {
  const grouped = {};
  mergeGameMap(grouped, map, 'seconds');
  return topItems(grouped, 'seconds', limit).map(item => ({
    id: item.id,
    name: item.name,
    game_seconds: item.value,
    sessions: numberValue(item.sessions),
    value: item.value
  }));
}

function mergeGamePairs(target, userItem) {
  if (!userItem || !userItem.id || isIgnoredUserId(userItem.id)) return;

  for (const game of Object.values(userItem.games || {})) {
    if (!game || !game.id) continue;

    const key = `${userItem.id}:${gameGroupKey(game)}`;
    const current = target[key] || {
      id: userItem.id,
      user_id: userItem.id,
      username: userItem.username || '',
      displayName: userItem.displayName || userItem.username || userItem.id,
      avatarUrl: userItem.avatarUrl || '',
      game_id: game.id,
      game_name: game.name || 'Nieznana gra',
      seconds: 0,
      sessions: 0
    };
    current.username = userItem.username || current.username;
    current.displayName = userItem.displayName || current.displayName;
    current.avatarUrl = userItem.avatarUrl || current.avatarUrl;
    current.game_name = game.name || current.game_name;
    current.seconds = numberValue(current.seconds) + numberValue(game.seconds);
    current.sessions = numberValue(current.sessions) + numberValue(game.sessions);
    target[key] = current;
  }
}

function userProfileOutput(profile) {
  return {
    id: profile.id,
    username: profile.username,
    display_name: profile.displayName,
    avatar_url: profile.avatarUrl,
    messages: numberValue(profile.messages),
    voice_seconds: numberValue(profile.voiceSeconds),
    game_seconds: numberValue(profile.gameSeconds),
    sessions: numberValue(profile.sessions),
    game_sessions: numberValue(profile.gameSessions),
    invites: numberValue(profile.invites),
    last_message_at: profile.lastMessageAt || '',
    last_voice_at: profile.lastVoiceAt || '',
    last_game_at: profile.lastGameAt || '',
    last_invite_at: profile.lastInviteAt || '',
    last_active_at: profile.lastActiveAt || '',
    top_text_channels: channelTopOutput(profile.textChannels, 'count', 'messages'),
    top_voice_channels: channelTopOutput(profile.voiceChannels, 'seconds', 'voice_seconds'),
    top_games: gameTopOutput(profile.games)
  };
}

function hourlyArray(source) {
  return EMPTY_HOURS.map(hour => ({
    hour,
    value: numberValue(source[hour])
  }));
}

function bestHourSummary(hourlyMessages, hourlyVoice) {
  const empty = {
    hour: '',
    messages: 0,
    voice_seconds: 0,
    voice_minutes: 0,
    score: 0,
    value: 0
  };
  const best = {
    messages: { ...empty },
    voice: { ...empty },
    combined: { ...empty }
  };

  for (const hour of EMPTY_HOURS) {
    const messages = numberValue(hourlyMessages[hour]);
    const voiceSeconds = numberValue(hourlyVoice[hour]);
    const voiceMinutes = Math.round(voiceSeconds / 60);
    const score = messages + voiceMinutes;

    if (messages > best.messages.value) {
      best.messages = { hour, messages, voice_seconds: voiceSeconds, voice_minutes: voiceMinutes, score, value: messages };
    }
    if (voiceSeconds > best.voice.value) {
      best.voice = { hour, messages, voice_seconds: voiceSeconds, voice_minutes: voiceMinutes, score, value: voiceSeconds };
    }
    if (score > best.combined.value) {
      best.combined = { hour, messages, voice_seconds: voiceSeconds, voice_minutes: voiceMinutes, score, value: score };
    }
  }

  return best;
}

function activeVoiceList(data, nowMs = Date.now()) {
  return Object.values(data.activeVoiceSessions || {})
    .filter(session => !isIgnoredUserId(session.userId) && !isIgnoredChannelId(session.channelId))
    .map(session => {
      const startedMs = Date.parse(session.startedAt);
      return {
        user_id: session.userId,
        username: session.username,
        display_name: session.displayName,
        avatar_url: session.avatarUrl,
        channel_id: session.channelId,
        channel_name: session.channelName,
        started_at: session.startedAt,
        duration_seconds: Number.isFinite(startedMs) ? Math.max(0, Math.round((nowMs - startedMs) / 1000)) : 0
      };
    })
    .sort((a, b) => b.duration_seconds - a.duration_seconds);
}

function dataWithActiveDurations(data, nowMs = Date.now()) {
  const snapshot = clone(data);

  for (const session of Object.values(data.activeVoiceSessions || {})) {
    if (isIgnoredUserId(session.userId)) continue;
    if (isIgnoredChannelId(session.channelId)) continue;
    const startedMs = Date.parse(session.startedAt);
    addVoiceDuration(snapshot, session, startedMs, nowMs, false);
  }

  for (const session of Object.values(data.activeGameSessions || {})) {
    if (isIgnoredUserId(session.userId)) continue;
    const startedMs = Date.parse(session.startedAt);
    addGameDuration(snapshot, session, startedMs, nowMs, false);
  }

  return snapshot;
}

function keysForPeriod(data, period, nowMs = Date.now()) {
  const selected = PERIODS[period] ? period : DEFAULT_PERIOD;
  const days = PERIODS[selected].days;
  if (!days) return Object.keys(data.days || {}).sort();

  return recentDateKeys(days, nowMs);
}

function summarizeRange(data, period = DEFAULT_PERIOD, topLimit = config.discordStats.topLimit, nowMs = Date.now()) {
  const selected = PERIODS[period] ? period : DEFAULT_PERIOD;
  const keys = keysForPeriod(data, selected, nowMs);
  const messageUsers = {};
  const voiceUsers = {};
  const gameUsers = {};
  const gamePairs = {};
  const inviteUsers = {};
  const userProfiles = {};
  const textChannels = {};
  const voiceChannels = {};
  const games = {};
  const hourlyMessages = {};
  const hourlyVoice = {};
  const hourlyGames = {};
  const daily = [];
  const timeline = [];
  let totalMessages = 0;
  let totalVoiceSeconds = 0;
  let totalGameSeconds = 0;
  let totalJoined = 0;
  let totalLeft = 0;
  let totalInvites = 0;
  let totalUnknownInvites = 0;

  for (const key of keys) {
    const day = getDay(data, key);
    const dayMessageUsers = filterUserMapByChannels(day.messages.byUser, 'count');
    const dayVoiceUsers = filterUserMapByChannels(day.voice.byUser, 'seconds');
    const dayGameUsers = {};
    mergeMap(dayGameUsers, day.games.byUser, 'seconds');
    const rawDayTextChannels = subtractIgnoredUserChannels(filterChannelMap(day.messages.byChannel), day.messages.byUser, 'count');
    const rawDayVoiceChannels = subtractIgnoredUserChannels(filterChannelMap(day.voice.byChannel), day.voice.byUser, 'seconds');
    const dayMessagesTotal = Object.keys(dayMessageUsers).length > 0
      ? sumMap(dayMessageUsers, 'count')
      : Object.keys(day.messages.byChannel || {}).length > 0
        ? sumMap(rawDayTextChannels, 'count')
        : numberValue(day.totalMessages);
    const dayVoiceTotal = Object.keys(dayVoiceUsers).length > 0
      ? sumMap(dayVoiceUsers, 'seconds')
      : Object.keys(day.voice.byChannel || {}).length > 0
        ? sumMap(rawDayVoiceChannels, 'seconds')
        : numberValue(day.totalVoiceSeconds);
    const dayTextChannels = sumMap(rawDayTextChannels, 'count') > dayMessagesTotal ? {} : rawDayTextChannels;
    const dayVoiceChannels = sumMap(rawDayVoiceChannels, 'seconds') > dayVoiceTotal ? {} : rawDayVoiceChannels;
    const dayGameTotal = Object.keys(dayGameUsers).length > 0
      ? sumMap(dayGameUsers, 'seconds')
      : numberValue(day.totalGameSeconds);
    const dayJoined = numberValue(day.members?.joined);
    const dayLeft = numberValue(day.members?.left);
    const dayInvites = numberValue(day.invites?.total);
    const dayUnknownInvites = numberValue(day.invites?.unknown);
    const activeIdsForDay = new Set([
      ...Object.keys(dayMessageUsers),
      ...Object.keys(dayVoiceUsers),
      ...Object.keys(dayGameUsers)
    ]);
    totalMessages += dayMessagesTotal;
    totalVoiceSeconds += dayVoiceTotal;
    totalGameSeconds += dayGameTotal;
    totalJoined += dayJoined;
    totalLeft += dayLeft;
    totalInvites += dayInvites;
    totalUnknownInvites += dayUnknownInvites;
    mergeMap(messageUsers, dayMessageUsers, 'count');
    mergeChannelMap(textChannels, dayTextChannels, 'count');
    mergeMap(voiceUsers, dayVoiceUsers, 'seconds');
    mergeChannelMap(voiceChannels, dayVoiceChannels, 'seconds');
    mergeMap(gameUsers, dayGameUsers, 'seconds');
    for (const item of Object.values(dayGameUsers)) {
      mergeGamePairs(gamePairs, item);
    }
    mergeGameMap(games, day.games.byGame, 'seconds');
    mergeMap(inviteUsers, day.invites.byInviter, 'count');

    daily.push({
      date: key,
      messages: dayMessagesTotal,
      voice_seconds: dayVoiceTotal,
      game_seconds: dayGameTotal,
      active_users: activeIdsForDay.size,
      joined: dayJoined,
      left: dayLeft,
      invites: dayInvites
    });

    for (const [userId, item] of Object.entries(dayMessageUsers)) {
      const profile = ensureUserProfile(userProfiles, data, userId, item);
      if (!profile) continue;
      profile.messages += numberValue(item.count);
      profile.lastMessageAt = latestIso(profile.lastMessageAt, item.lastMessageAt);
      profile.lastActiveAt = latestIso(profile.lastActiveAt, profile.lastMessageAt);
      mergeChannelBreakdown(profile.textChannels, item.channels, 'count');
    }

    for (const [userId, item] of Object.entries(dayVoiceUsers)) {
      const profile = ensureUserProfile(userProfiles, data, userId, item);
      if (!profile) continue;
      profile.voiceSeconds += numberValue(item.seconds);
      profile.sessions += numberValue(item.sessions);
      profile.lastVoiceAt = latestIso(profile.lastVoiceAt, item.lastVoiceAt);
      profile.lastActiveAt = latestIso(profile.lastActiveAt, profile.lastVoiceAt);
      mergeChannelBreakdown(profile.voiceChannels, item.channels, 'seconds');
    }

    for (const [userId, item] of Object.entries(dayGameUsers)) {
      const profile = ensureUserProfile(userProfiles, data, userId, item);
      if (!profile) continue;
      profile.gameSeconds += numberValue(item.seconds);
      profile.gameSessions += numberValue(item.sessions);
      profile.lastGameAt = latestIso(profile.lastGameAt, item.lastGameAt);
      profile.lastActiveAt = latestIso(profile.lastActiveAt, profile.lastGameAt);
      mergeGameMap(profile.games, item.games, 'seconds');
    }

    for (const [userId, item] of Object.entries(day.invites.byInviter || {})) {
      if (isIgnoredUserId(userId)) continue;
      const profile = ensureUserProfile(userProfiles, data, userId, item);
      if (!profile) continue;
      profile.invites += numberValue(item.count);
      profile.lastInviteAt = latestIso(profile.lastInviteAt, item.lastInviteAt);
    }

    for (const hour of EMPTY_HOURS) {
      hourlyMessages[hour] = numberValue(hourlyMessages[hour]) + numberValue(day.messages.byHour[hour]);
      hourlyVoice[hour] = numberValue(hourlyVoice[hour]) + numberValue(day.voice.byHour[hour]);
      hourlyGames[hour] = numberValue(hourlyGames[hour]) + numberValue(day.games.byHour[hour]);
      const memberHour = day.members?.byHour?.[hour] || {};
      const inviteHour = day.invites?.byHour?.[hour] || {};
      timeline.push({
        date: key,
        hour,
        messages: numberValue(day.messages.byHour[hour]),
        voice_seconds: numberValue(day.voice.byHour[hour]),
        game_seconds: numberValue(day.games.byHour[hour]),
        joined: numberValue(memberHour.joined),
        left: numberValue(memberHour.left),
        invites: numberValue(inviteHour.total)
      });
    }
  }

  const activeUserIds = new Set([
    ...Object.keys(messageUsers),
    ...Object.keys(voiceUsers),
    ...Object.keys(gameUsers)
  ]);
  const users = {};
  for (const profile of Object.values(userProfiles)) {
    users[profile.id] = userProfileOutput(profile);
  }

  return {
    period: selected,
    label: PERIODS[selected].label,
    days: keys,
    daily,
    totals: {
      messages: totalMessages,
      voice_seconds: totalVoiceSeconds,
      game_seconds: totalGameSeconds,
      active_users: activeUserIds.size,
      text_channels: Object.keys(textChannels).length,
      voice_channels: Object.keys(voiceChannels).length,
      joined: totalJoined,
      left: totalLeft,
      invites: totalInvites,
      unknown_invites: totalUnknownInvites
    },
    top_message_users: topItems(messageUsers, 'count', topLimit).map(item => ({
      id: item.id,
      username: item.username,
      display_name: item.displayName,
      avatar_url: item.avatarUrl,
      messages: item.value,
      value: item.value
    })),
    top_voice_users: topItems(voiceUsers, 'seconds', topLimit).map(item => ({
      id: item.id,
      username: item.username,
      display_name: item.displayName,
      avatar_url: item.avatarUrl,
      voice_seconds: item.value,
      sessions: numberValue(item.sessions),
      value: item.value
    })),
    top_game_users: topItems(gameUsers, 'seconds', topLimit).map(item => ({
      id: item.id,
      username: item.username,
      display_name: item.displayName,
      avatar_url: item.avatarUrl,
      game_seconds: item.value,
      sessions: numberValue(item.sessions),
      value: item.value
    })),
    top_game_pairs: topItems(gamePairs, 'seconds', topLimit).map(item => ({
      id: item.id,
      user_id: item.user_id,
      username: item.username,
      display_name: item.displayName,
      avatar_url: item.avatarUrl,
      game_id: item.game_id,
      game_name: item.game_name,
      game_seconds: item.value,
      sessions: numberValue(item.sessions),
      value: item.value
    })),
    top_invites: topItems(inviteUsers, 'count', topLimit).map(item => ({
      id: item.id,
      username: item.username,
      display_name: item.displayName,
      avatar_url: item.avatarUrl,
      invites: item.value,
      value: item.value
    })),
    top_text_channels: topItems(textChannels, 'count', topLimit).map(item => ({
      id: item.id,
      name: item.name,
      messages: item.value,
      value: item.value
    })),
    top_voice_channels: topItems(voiceChannels, 'seconds', topLimit).map(item => ({
      id: item.id,
      name: item.name,
      voice_seconds: item.value,
      sessions: numberValue(item.sessions),
      value: item.value
    })),
    top_games: topItems(games, 'seconds', topLimit).map(item => ({
      id: item.id,
      name: item.name,
      game_seconds: item.value,
      sessions: numberValue(item.sessions),
      value: item.value
    })),
    hourly_messages: hourlyArray(hourlyMessages),
    hourly_voice_seconds: hourlyArray(hourlyVoice),
    hourly_game_seconds: hourlyArray(hourlyGames),
    timeline,
    text_vs_voice: {
      messages: totalMessages,
      voice_seconds: totalVoiceSeconds,
      voice_minutes: Math.round(totalVoiceSeconds / 60)
    },
    best_hours: bestHourSummary(hourlyMessages, hourlyVoice),
    users
  };
}

function applyGuildNicknamesToItem(guild, item) {
  if (!guild || !item) return item;
  const memberId = item.user_id || item.id;
  if (!memberId) return item;

  const member = guild.members.cache.get(memberId);
  if (!member) return item;

  item.display_name = member.displayName || item.display_name || item.username || memberId;
  item.username = member.user?.username || item.username || '';
  item.avatar_url = typeof member.user?.displayAvatarURL === 'function'
    ? member.user.displayAvatarURL({ extension: 'png', size: 64 })
    : item.avatar_url;

  return item;
}

function applyGuildNicknamesToSummary(guild, summary) {
  for (const key of ['top_message_users', 'top_voice_users', 'top_game_users', 'top_game_pairs', 'top_invites']) {
    for (const item of summary[key] || []) {
      applyGuildNicknamesToItem(guild, item);
    }
  }

  for (const item of Object.values(summary.users || {})) {
    applyGuildNicknamesToItem(guild, item);
  }

  return summary;
}

function getRangeStats(period = DEFAULT_PERIOD, topLimit = config.discordStats.topLimit) {
  const nowMs = Date.now();
  const data = dataWithActiveDurations(readStatsDataForSummary(), nowMs);
  return summarizeRange(data, period, topLimit, nowMs);
}

function getUserStats(period, userId) {
  const nowMs = Date.now();
  const data = dataWithActiveDurations(readStatsDataForSummary(), nowMs);
  const selected = PERIODS[period] ? period : DEFAULT_PERIOD;
  const range = summarizeRange(data, selected, config.discordStats.topLimit, nowMs);
  const profile = range.users?.[userId] || null;

  return {
    period: selected,
    label: PERIODS[selected].label,
    user: profile,
    messages: numberValue(profile?.messages),
    voice_seconds: numberValue(profile?.voice_seconds),
    game_seconds: numberValue(profile?.game_seconds),
    sessions: numberValue(profile?.sessions),
    game_sessions: numberValue(profile?.game_sessions),
    invites: numberValue(profile?.invites),
    last_active_at: profile?.last_active_at || '',
    last_message_at: profile?.last_message_at || '',
    last_voice_at: profile?.last_voice_at || '',
    last_game_at: profile?.last_game_at || '',
    last_invite_at: profile?.last_invite_at || '',
    top_text_channels: profile?.top_text_channels || [],
    top_voice_channels: profile?.top_voice_channels || [],
    top_games: profile?.top_games || []
  };
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(secs).padStart(2, '0')}s`;
  return `${secs}s`;
}

async function buildWordpressPayload(client) {
  const nowMs = Date.now();
  const data = dataWithActiveDurations(loadStatsData(), nowMs);
  const guild = client.guilds.cache.get(config.discord.guildId) || client.guilds.cache.first();
  const ranges = {
    today: summarizeRange(data, 'today', config.discordStats.topLimit, nowMs),
    '7d': summarizeRange(data, '7d', config.discordStats.topLimit, nowMs),
    '30d': summarizeRange(data, '30d', config.discordStats.topLimit, nowMs),
    all: summarizeRange(data, 'all', config.discordStats.topLimit, nowMs)
  };

  if (guild) {
    for (const range of Object.values(ranges)) {
      applyGuildNicknamesToSummary(guild, range);
    }
  }

  const activeVoice = activeVoiceList(loadStatsData(), nowMs);
  if (guild) {
    for (const item of activeVoice) {
      applyGuildNicknamesToItem(guild, item);
    }
  }

  return {
    version: STATS_VERSION,
    generated_at: new Date(nowMs).toISOString(),
    timezone: config.discordStats.timezone,
    guild: guild
      ? {
          id: guild.id,
          name: guild.name,
          icon_url: typeof guild.iconURL === 'function' ? guild.iconURL({ extension: 'png', size: 128 }) : '',
          member_count: guild.memberCount || 0
        }
      : {
          id: config.discord.guildId,
          name: '',
          icon_url: '',
          member_count: 0
        },
    ranges,
    active_voice: activeVoice,
    retained_days: Object.keys(loadStatsData().days || {}).sort()
  };
}

async function syncStatsToWordpress(client) {
  const endpoint = config.wordpress.discordStatsEndpoint;
  if (!endpoint) {
    const now = Date.now();
    if (now - lastMissingEndpointWarning > 60 * 60 * 1000) {
      console.warn('[discordStats] Brakuje WP_DISCORD_STATS_ENDPOINT - pomijam synchronizacje z WP.');
      lastMissingEndpointWarning = now;
    }
    return null;
  }

  const headers = {
    'Content-Type': 'application/json'
  };

  if (config.wordpress.discordStatsToken) {
    headers.Authorization = `Bearer ${config.wordpress.discordStatsToken}`;
  }

  const payload = await buildWordpressPayload(client);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let body = {};

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  if (!response.ok) {
    throw new Error(`WP discord stats error ${response.status}: ${JSON.stringify(body)}`);
  }

  const data = loadStatsData();
  data.lastSyncAt = new Date().toISOString();
  markDirty();
  flushStats(true);
  return body;
}

function setupDiscordStats(client) {
  if (!config.discordStats.enabled) {
    console.warn('[discordStats] DISCORD_STATS_ENABLED=false - modul wylaczony.');
    return;
  }

  loadStatsData();

  client.on('messageCreate', message => {
    try {
      if (!message.guild || shouldIgnoreUser(message.author) || shouldIgnoreChannel(message.channel)) return;
      bumpMessage(message);
    } catch (error) {
      console.error('[discordStats] Blad zliczania wiadomosci:', error);
    }
  });

  client.on('voiceStateUpdate', (oldState, newState) => {
    try {
      handleVoiceState(oldState, newState);
    } catch (error) {
      console.error('[discordStats] Blad zliczania voice:', error);
    }
  });

  client.on('presenceUpdate', (oldPresence, newPresence) => {
    try {
      handlePresenceUpdate(oldPresence, newPresence);
    } catch (error) {
      console.error('[discordStats] Blad zliczania gier:', error);
    }
  });

  client.on('inviteCreate', invite => {
    refreshInviteCache(invite.guild).catch(error => {
      console.error('[discordStats] Blad odswiezania invite cache:', error.message);
    });
  });

  client.on('inviteDelete', invite => {
    refreshInviteCache(invite.guild).catch(error => {
      console.error('[discordStats] Blad odswiezania invite cache:', error.message);
    });
  });

  client.on('guildMemberAdd', member => {
    try {
      bumpMemberEvent('joined');
      recordInviteUse(member).catch(error => {
        console.error('[discordStats] Blad zliczania zaproszenia:', error.message);
      });
    } catch (error) {
      console.error('[discordStats] Blad zliczania dolaczenia:', error);
    }
  });

  client.on('guildMemberRemove', () => {
    try {
      bumpMemberEvent('left');
    } catch (error) {
      console.error('[discordStats] Blad zliczania odejscia:', error);
    }
  });

  client.once('clientReady', async () => {
    await hydrateCurrentVoiceSessions(client).catch(error => {
      console.error('[discordStats] Blad inicjalizacji sesji voice:', error);
    });

    await hydrateCurrentGameSessions(client).catch(error => {
      console.error('[discordStats] Blad inicjalizacji sesji gier:', error);
    });

    await hydrateInviteCaches(client).catch(error => {
      console.error('[discordStats] Blad inicjalizacji invite cache:', error);
    });

    setInterval(() => {
      pruneOldDays(loadStatsData());
      flushStats();
    }, Math.max(10 * 1000, config.discordStats.flushIntervalMs));

    setInterval(() => {
      syncStatsToWordpress(client).catch(error => {
        console.error('[discordStats] Blad synchronizacji z WP:', error.message);
      });
    }, Math.max(60 * 1000, config.discordStats.syncIntervalMs));

    setTimeout(() => {
      syncStatsToWordpress(client).catch(error => {
        console.error('[discordStats] Blad pierwszej synchronizacji z WP:', error.message);
      });
    }, 20 * 1000);
  });

  process.once('beforeExit', () => flushStats(true));
}

module.exports = {
  setupDiscordStats,
  buildWordpressPayload,
  getRangeStats,
  getUserStats,
  formatDuration
};
