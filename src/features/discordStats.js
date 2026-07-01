// Lekkie statystyki aktywnosci Discorda: liczniki wiadomosci i czasu voice.
// Modul nie zapisuje tresci wiadomosci, tylko agregaty per dzien/uzytkownik/kanal.
const { config } = require('../config');
const { readJson, writeJson } = require('../jsonStore');

const EMPTY_HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));
const DEFAULT_PERIOD = '7d';
const STATS_VERSION = 2;
const PROFILE_CHANNEL_LIMIT = 5;
const PERIODS = {
  today: { label: 'Dzisiaj', days: 1 },
  '7d': { label: 'Ostatnie 7 dni', days: 7 },
  '30d': { label: 'Ostatnie 30 dni', days: 30 },
  all: { label: 'Caly zapisany okres', days: null }
};

let memoryData = null;
let dirty = false;
let lastMissingEndpointWarning = 0;

function emptyStatsData() {
  return {
    version: STATS_VERSION,
    users: {},
    days: {},
    activeVoiceSessions: {},
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
  current.lastActiveAt = latestIso(current.lastActiveAt, activityAt, current.lastMessageAt, current.lastVoiceAt);

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
    messages: {
      byUser: {},
      byChannel: {},
      byHour: {}
    },
    voice: {
      byUser: {},
      byChannel: {},
      byHour: {}
    }
  };
}

function getDay(data, dateKey) {
  if (!data.days[dateKey]) data.days[dateKey] = emptyDay();
  const day = data.days[dateKey];
  day.totalMessages = numberValue(day.totalMessages);
  day.totalVoiceSeconds = numberValue(day.totalVoiceSeconds);
  day.messages = day.messages || {};
  day.messages.byUser = day.messages.byUser || {};
  day.messages.byChannel = day.messages.byChannel || {};
  day.messages.byHour = day.messages.byHour || {};
  day.voice = day.voice || {};
  day.voice.byUser = day.voice.byUser || {};
  day.voice.byChannel = day.voice.byChannel || {};
  day.voice.byHour = day.voice.byHour || {};
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
  const maxChunkMs = 5 * 60 * 1000;

  while (cursor < endMs) {
    const chunkEnd = Math.min(endMs, cursor + maxChunkMs);
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
    sessions: 0,
    lastMessageAt: '',
    lastVoiceAt: '',
    lastActiveAt: '',
    textChannels: {},
    voiceChannels: {}
  };

  current.username = indexed.username || item.username || current.username || userId;
  current.displayName = indexed.displayName || item.displayName || current.displayName || current.username || userId;
  current.avatarUrl = indexed.avatarUrl || item.avatarUrl || current.avatarUrl || '';
  current.lastMessageAt = latestIso(current.lastMessageAt, indexed.lastMessageAt, item.lastMessageAt);
  current.lastVoiceAt = latestIso(current.lastVoiceAt, indexed.lastVoiceAt, item.lastVoiceAt);
  current.lastActiveAt = latestIso(current.lastActiveAt, indexed.lastActiveAt, item.lastActiveAt, current.lastMessageAt, current.lastVoiceAt);

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
  return topItems(map, valueField, limit).map(item => ({
    id: item.id,
    name: item.name,
    [outputKey]: item.value,
    sessions: numberValue(item.sessions),
    value: item.value
  }));
}

function userProfileOutput(profile) {
  return {
    id: profile.id,
    username: profile.username,
    display_name: profile.displayName,
    avatar_url: profile.avatarUrl,
    messages: numberValue(profile.messages),
    voice_seconds: numberValue(profile.voiceSeconds),
    sessions: numberValue(profile.sessions),
    last_message_at: profile.lastMessageAt || '',
    last_voice_at: profile.lastVoiceAt || '',
    last_active_at: profile.lastActiveAt || '',
    top_text_channels: channelTopOutput(profile.textChannels, 'count', 'messages'),
    top_voice_channels: channelTopOutput(profile.voiceChannels, 'seconds', 'voice_seconds')
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
  const userProfiles = {};
  const textChannels = {};
  const voiceChannels = {};
  const hourlyMessages = {};
  const hourlyVoice = {};
  const daily = [];
  let totalMessages = 0;
  let totalVoiceSeconds = 0;

  for (const key of keys) {
    const day = getDay(data, key);
    const dayMessageUsers = filterUserMapByChannels(day.messages.byUser, 'count');
    const dayVoiceUsers = filterUserMapByChannels(day.voice.byUser, 'seconds');
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
    const activeIdsForDay = new Set([
      ...Object.keys(dayMessageUsers),
      ...Object.keys(dayVoiceUsers)
    ]);
    totalMessages += dayMessagesTotal;
    totalVoiceSeconds += dayVoiceTotal;
    mergeMap(messageUsers, dayMessageUsers, 'count');
    mergeMap(textChannels, dayTextChannels, 'count');
    mergeMap(voiceUsers, dayVoiceUsers, 'seconds');
    mergeMap(voiceChannels, dayVoiceChannels, 'seconds');

    daily.push({
      date: key,
      messages: dayMessagesTotal,
      voice_seconds: dayVoiceTotal,
      active_users: activeIdsForDay.size
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

    for (const hour of EMPTY_HOURS) {
      hourlyMessages[hour] = numberValue(hourlyMessages[hour]) + numberValue(day.messages.byHour[hour]);
      hourlyVoice[hour] = numberValue(hourlyVoice[hour]) + numberValue(day.voice.byHour[hour]);
    }
  }

  const activeUserIds = new Set([
    ...Object.keys(messageUsers),
    ...Object.keys(voiceUsers)
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
      active_users: activeUserIds.size,
      text_channels: Object.keys(textChannels).length,
      voice_channels: Object.keys(voiceChannels).length
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
    hourly_messages: hourlyArray(hourlyMessages),
    hourly_voice_seconds: hourlyArray(hourlyVoice),
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
  const memberId = item.id || item.user_id;
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
  for (const key of ['top_message_users', 'top_voice_users']) {
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
    sessions: numberValue(profile?.sessions),
    last_active_at: profile?.last_active_at || '',
    last_message_at: profile?.last_message_at || '',
    last_voice_at: profile?.last_voice_at || '',
    top_text_channels: profile?.top_text_channels || [],
    top_voice_channels: profile?.top_voice_channels || []
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

  client.once('clientReady', async () => {
    await hydrateCurrentVoiceSessions(client).catch(error => {
      console.error('[discordStats] Blad inicjalizacji sesji voice:', error);
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
