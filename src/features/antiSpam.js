// Wykrywa spam po zachowaniu: duplikaty na wielu kanalach, szybkie serie
// wiadomosci oraz zaproszenia/podejrzane linki.
const { EmbedBuilder, MessageType } = require('discord.js');
const { config } = require('../config');
const { readJson, writeJson } = require('../jsonStore');
const { logToFile } = require('../logger');

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<]+/gi;
const DISCORD_INVITE_PATTERN = /\b(?:discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i;
const ZERO_WIDTH_PATTERN = /[\u200B-\u200D\uFEFF]/g;
const ACTION_TIMEOUT = 'timeout';
const ACTION_BAN = 'ban';
const ACTION_ALERT = 'alert';
const validActions = new Set([ACTION_TIMEOUT, ACTION_BAN, ACTION_ALERT]);

const suspiciousLinkPatterns = [
  /free[-\s_]*nitro/i,
  /nitro[-\s_]*(?:free|gift|generator)/i,
  /steam(?:community)?\.[^\s/]+\/gift/i,
  /airdrop/i,
  /wallet[-\s_]*connect/i,
  /verify[-\s_]*(?:account|discord)/i,
  /discord[-\s_]*nitro/i
];

const recentMessagesByUser = new Map();
const lastActionByUser = new Map();

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeAction(action, fallback = ACTION_TIMEOUT) {
  const normalized = String(action || '').toLowerCase();
  return validActions.has(normalized) ? normalized : fallback;
}

function readState() {
  const state = readJson(config.files.antiSpam, {
    settings: {}
  });

  return {
    settings: state.settings && typeof state.settings === 'object' ? state.settings : {}
  };
}

function writeState(state) {
  writeJson(config.files.antiSpam, state);
}

function getAntiSpamSettings(state = readState()) {
  const settings = state.settings;
  const defaultAction = normalizeAction(config.antiSpam.action);

  return {
    enabled: settings.enabled ?? config.antiSpam.enabled,
    dryRun: settings.dryRun ?? config.antiSpam.dryRun,
    action: normalizeAction(settings.action, defaultAction),
    alertChannelId: settings.alertChannelId || config.antiSpam.alertChannelId,
    alertRoleIds: Array.isArray(settings.alertRoleIds) ? settings.alertRoleIds : config.antiSpam.alertRoleIds,
    trustedRoleIds: Array.isArray(settings.trustedRoleIds) ? settings.trustedRoleIds : config.antiSpam.trustedRoleIds,
    ignoredChannelIds: Array.isArray(settings.ignoredChannelIds) ? settings.ignoredChannelIds : config.antiSpam.ignoredChannelIds,
    ignoredCategoryIds: Array.isArray(settings.ignoredCategoryIds) ? settings.ignoredCategoryIds : config.antiSpam.ignoredCategoryIds,
    timeoutMinutes: clampNumber(settings.timeoutMinutes, 1, 10080, config.antiSpam.timeoutMinutes),
    duplicateWindowSeconds: clampNumber(settings.duplicateWindowSeconds, 5, 300, config.antiSpam.duplicateWindowSeconds),
    duplicateChannelLimit: clampNumber(settings.duplicateChannelLimit, 2, 10, config.antiSpam.duplicateChannelLimit),
    duplicateMinLength: clampNumber(settings.duplicateMinLength, 1, 200, config.antiSpam.duplicateMinLength),
    duplicateSimilarity: clampNumber(settings.duplicateSimilarity, 0.5, 1, config.antiSpam.duplicateSimilarity),
    rateLimitCount: clampNumber(settings.rateLimitCount, 2, 50, config.antiSpam.rateLimitCount),
    rateLimitSeconds: clampNumber(settings.rateLimitSeconds, 2, 300, config.antiSpam.rateLimitSeconds),
    actionCooldownSeconds: clampNumber(settings.actionCooldownSeconds, 5, 3600, config.antiSpam.actionCooldownSeconds),
    blockDiscordInvites: settings.blockDiscordInvites ?? config.antiSpam.blockDiscordInvites,
    blockSuspiciousLinks: settings.blockSuspiciousLinks ?? config.antiSpam.blockSuspiciousLinks
  };
}

function updateAntiSpamSettings(updates) {
  const state = readState();
  state.settings = {
    ...state.settings,
    ...updates,
    updatedAt: new Date().toISOString()
  };
  writeState(state);
  return getAntiSpamSettings(state);
}

function resetAntiSpamSettings() {
  const state = readState();
  state.settings = {};
  writeState(state);
  return getAntiSpamSettings(state);
}

function getAntiSpamStatus() {
  const state = readState();
  return {
    settings: getAntiSpamSettings(state),
    savedSettings: state.settings
  };
}

function setupAntiSpam(client) {
  const settings = getAntiSpamSettings();
  if (!settings.enabled) {
    console.log('[antiSpam] Funkcja wylaczona w ustawieniach.');
  }

  client.on('messageCreate', async message => {
    try {
      await handleMessage(message);
    } catch (error) {
      console.error('[antiSpam] Blad:', error);
      logToFile(`[antiSpam] Blad: ${error.message}`);
    }
  });
}

async function handleMessage(message) {
  const settings = getAntiSpamSettings();
  if (!settings.enabled) return;

  if (!message.guild || message.author?.bot) return;
  if (!message.channel?.isTextBased?.()) return;
  if (![MessageType.Default, MessageType.Reply].includes(message.type)) return;
  if (isIgnoredChannel(message, settings)) return;

  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member || isTrustedMember(member, settings)) return;

  const content = message.content || '';
  const normalized = normalizeContent(content);
  if (!normalized && message.attachments.size === 0) return;

  const now = Date.now();
  const userKey = `${message.guild.id}:${message.author.id}`;
  const history = getPrunedHistory(userKey, now, settings);
  const entry = createEntry(message, normalized, now);
  const linkInfo = inspectLinks(content);

  const reasons = [];
  const messagesToDelete = new Map();

  const duplicateMatches = findDuplicateMatches(history, entry, settings);
  if (duplicateMatches.length > 0) {
    const channelCount = new Set([...duplicateMatches, entry].map(item => item.channelId)).size;
    reasons.push(`Ta sama lub bardzo podobna wiadomosc na ${channelCount} kanalach w ${settings.duplicateWindowSeconds}s.`);
    addEntriesToDelete(messagesToDelete, duplicateMatches);
    messagesToDelete.set(entry.messageId, entry);
  }

  const rateMatches = findRateLimitMatches(history, entry, settings);
  if (rateMatches.length >= settings.rateLimitCount) {
    reasons.push(`${rateMatches.length} wiadomosci w ${settings.rateLimitSeconds}s.`);
    addEntriesToDelete(messagesToDelete, rateMatches);
  }

  if (settings.blockDiscordInvites && linkInfo.hasDiscordInvite) {
    reasons.push('Wykryto zaproszenie Discord.');
    messagesToDelete.set(entry.messageId, entry);
  }

  if (settings.blockSuspiciousLinks && linkInfo.hasSuspiciousLink) {
    reasons.push('Wykryto podejrzany link lub fraze scamowa.');
    messagesToDelete.set(entry.messageId, entry);
  }

  history.push(entry);
  recentMessagesByUser.set(userKey, history);

  if (reasons.length === 0) return;

  const cooldownUntil = lastActionByUser.get(userKey) || 0;
  if (now < cooldownUntil) {
    if (!settings.dryRun && settings.action !== ACTION_ALERT) {
      await deleteMessages([entry], 'kolejny spam w czasie cooldownu');
    }
    return;
  }

  lastActionByUser.set(userKey, now + settings.actionCooldownSeconds * 1000);

  const actions = [];
  if (settings.dryRun) {
    actions.push('TRYB TESTOWY: bez kasowania i bez timeoutu.');
  } else if (settings.action === ACTION_ALERT) {
    actions.push('Tylko alert: bez kasowania i bez kary automatycznej.');
  } else {
    const deletedCount = await deleteMessages([...messagesToDelete.values()], reasons.join(' '));
    actions.push(`Usunieto wiadomosci: ${deletedCount}.`);

    const punishmentResult = await punishMember(member, reasons.join(' '), settings);
    actions.push(punishmentResult);
  }

  await sendAlert(message, reasons, actions, linkInfo, settings);
}

function isIgnoredChannel(message, settings) {
  const ignoredChannels = new Set(settings.ignoredChannelIds);
  const ignoredCategories = new Set(settings.ignoredCategoryIds);
  return ignoredChannels.has(message.channel.id) || ignoredCategories.has(message.channel.parentId);
}

function isTrustedMember(member, settings) {
  const trustedRoleIds = new Set(settings.trustedRoleIds);
  return member.roles.cache.some(role => trustedRoleIds.has(role.id));
}

function createEntry(message, normalized, createdAt) {
  return {
    createdAt,
    guildId: message.guild.id,
    channelId: message.channel.id,
    messageId: message.id,
    authorId: message.author.id,
    authorTag: message.author.tag,
    content: message.content || '',
    normalized,
    message
  };
}

function getPrunedHistory(userKey, now, settings) {
  const ttlMs = Math.max(
    settings.duplicateWindowSeconds,
    settings.rateLimitSeconds
  ) * 1000;
  const history = recentMessagesByUser.get(userKey) || [];
  return history.filter(entry => now - entry.createdAt <= ttlMs);
}

function findDuplicateMatches(history, entry, settings) {
  if (entry.normalized.length < settings.duplicateMinLength) return [];

  const windowMs = settings.duplicateWindowSeconds * 1000;
  const matches = history.filter(item => {
    if (entry.createdAt - item.createdAt > windowMs) return false;
    if (item.channelId === entry.channelId) return false;
    return areMessagesSimilar(item.normalized, entry.normalized, settings);
  });

  const channelCount = new Set([...matches, entry].map(item => item.channelId)).size;
  return channelCount >= settings.duplicateChannelLimit ? matches : [];
}

function findRateLimitMatches(history, entry, settings) {
  const windowMs = settings.rateLimitSeconds * 1000;
  return [...history, entry].filter(item => entry.createdAt - item.createdAt <= windowMs);
}

function normalizeContent(content) {
  return content
    .replace(ZERO_WIDTH_PATTERN, '')
    .replace(URL_PATTERN, normalizeUrlMatch)
    .replace(/<@!?\d+>/g, '<user>')
    .replace(/<@&\d+>/g, '<role>')
    .replace(/<#\d+>/g, '<channel>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeUrlMatch(rawUrl) {
  const withProtocol = rawUrl.startsWith('www.') ? `https://${rawUrl}` : rawUrl;

  try {
    const url = new URL(withProtocol);
    return `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return rawUrl.toLowerCase();
  }
}

function inspectLinks(content) {
  const urls = content.match(URL_PATTERN) || [];
  const hasDiscordInvite = DISCORD_INVITE_PATTERN.test(content);
  const hasSuspiciousLink = urls.length > 0 && suspiciousLinkPatterns.some(pattern => pattern.test(content));

  return {
    urls,
    hasDiscordInvite,
    hasSuspiciousLink
  };
}

function areMessagesSimilar(left, right, settings) {
  if (left === right) return true;
  if (left.length < settings.duplicateMinLength || right.length < settings.duplicateMinLength) return false;

  const maxLength = Math.max(left.length, right.length);
  const lengthDiff = Math.abs(left.length - right.length);
  if (lengthDiff > Math.max(10, maxLength * (1 - settings.duplicateSimilarity))) return false;

  const leftSample = left.slice(0, 500);
  const rightSample = right.slice(0, 500);
  const distance = levenshteinDistance(leftSample, rightSample);
  const similarity = 1 - distance / Math.max(leftSample.length, rightSample.length);

  return similarity >= settings.duplicateSimilarity;
}

function levenshteinDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;

    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }

    for (let j = 0; j <= right.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[right.length];
}

function addEntriesToDelete(target, entries) {
  for (const entry of entries) {
    target.set(entry.messageId, entry);
  }
}

async function deleteMessages(entries, reason) {
  let deletedCount = 0;

  for (const entry of entries) {
    const message = entry.message;
    if (!message?.deletable) continue;

    try {
      await message.delete();
      deletedCount += 1;
    } catch (error) {
      logToFile(`[antiSpam] Nie udalo sie usunac wiadomosci ${entry.messageId}: ${error.message}. Powod: ${reason}`);
    }
  }

  return deletedCount;
}

async function punishMember(member, reason, settings) {
  if (settings.action === ACTION_BAN) {
    return banMember(member, reason);
  }

  return timeoutMember(member, reason, settings);
}

async function timeoutMember(member, reason, settings) {
  if (!member.moderatable) {
    return 'Timeout nieudany: bot nie moze moderowac tego uzytkownika.';
  }

  try {
    const timeoutMs = settings.timeoutMinutes * 60 * 1000;
    await member.timeout(timeoutMs, `Anti-spam: ${reason}`.slice(0, 512));
    return `Nalozono przerwe: ${settings.timeoutMinutes} min.`;
  } catch (error) {
    logToFile(`[antiSpam] Nie udalo sie nadac timeoutu ${member.user.tag}: ${error.message}`);
    return `Timeout nieudany: ${error.message}`;
  }
}

async function banMember(member, reason) {
  if (!member.bannable) {
    return 'Ban nieudany: bot nie moze zbanowac tego uzytkownika.';
  }

  try {
    await member.ban({
      deleteMessageSeconds: 0,
      reason: `Anti-spam: ${reason}`.slice(0, 512)
    });
    return 'Zbanowano uzytkownika.';
  } catch (error) {
    logToFile(`[antiSpam] Nie udalo sie zbanowac ${member.user.tag}: ${error.message}`);
    return `Ban nieudany: ${error.message}`;
  }
}

async function sendAlert(message, reasons, actions, linkInfo, settings) {
  const channel = await message.guild.channels
    .fetch(settings.alertChannelId)
    .catch(() => null);

  if (!channel?.isTextBased?.()) {
    logToFile(`[antiSpam] Nie znaleziono kanalu alertow: ${settings.alertChannelId}`);
    return;
  }

  const roleMentions = settings.alertRoleIds.map(roleId => `<@&${roleId}>`).join(' ');
  const content = roleMentions || undefined;
  const messageContent = sanitizeForEmbed(message.content || '<brak tresci>');

  const embed = new EmbedBuilder()
    .setColor(settings.dryRun ? 0xffc107 : 0xff3333)
    .setTitle(getAlertTitle(settings))
    .addFields(
      { name: 'Uzytkownik', value: `${message.author.tag}\n${message.author.id}`, inline: true },
      { name: 'Kanal', value: `${message.channel}`, inline: true },
      { name: 'Powody', value: reasons.join('\n').slice(0, 1024), inline: false },
      { name: 'Akcje', value: actions.join('\n').slice(0, 1024), inline: false },
      { name: 'Tresc', value: messageContent.slice(0, 1024), inline: false }
    )
    .setFooter({ text: `Wiadomosc: ${message.id}` })
    .setTimestamp();

  if (linkInfo.urls.length > 0) {
    embed.addFields({
      name: 'Linki',
      value: linkInfo.urls.map(sanitizeForEmbed).join('\n').slice(0, 1024),
      inline: false
    });
  }

  try {
    await channel.send({
      content,
      embeds: [embed],
      allowedMentions: {
        roles: settings.alertRoleIds
      }
    });
  } catch (error) {
    logToFile(`[antiSpam] Blad wysylki alertu: ${error.message}`);
  }
}

function getAlertTitle(settings) {
  if (settings.dryRun) return 'Anti-spam: wykrycie testowe';
  if (settings.action === ACTION_BAN) return 'Anti-spam: zbanowano spamera';
  if (settings.action === ACTION_ALERT) return 'Anti-spam: alert do administracji';
  return 'Anti-spam: nalozono przerwe';
}

function sanitizeForEmbed(value) {
  const zeroWidth = String.fromCharCode(8203);
  return String(value)
    .replace(/@/g, `@${zeroWidth}`)
    .replace(/`/g, "'");
}

module.exports = {
  setupAntiSpam,
  getAntiSpamSettings,
  getAntiSpamStatus,
  resetAntiSpamSettings,
  updateAntiSpamSettings
};
