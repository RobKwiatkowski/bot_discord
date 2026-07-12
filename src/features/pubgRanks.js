// Reset rang po zmianie sezonu PUBG. Komendy uzytkownika sa w /pubg.
const fs = require('fs');
const { config } = require('../config');
const { readJson, writeJson } = require('../jsonStore');
const { logToFile } = require('../logger');
const { getCurrentSeason, getPlayerByName, pubgRequest } = require('../pubgApi');
const { RANK_ROLES, compareRankedModes, normalizeRankName, resolveRank } = require('../pubgRankUtils');

const RANK_ROLE_NAMES = new Set(RANK_ROLES.map(role => role.toUpperCase()));
const GUILD_MEMBERS_PAGE_SIZE = 1000;

async function ensureRole(guild, baseRank) {
  let role = guild.roles.cache.find(item => item.name.toUpperCase() === baseRank.toUpperCase());
  if (!role) {
    const roleName = normalizeRankName(baseRank);
    role = await guild.roles.create({ name: roleName, reason: 'PUBG Rank Sync' });
    logToFile(`Utworzono role PUBG: ${roleName}`);
  }
  return role;
}

function canResetRankRoles() {
  if (!config.discord.enableGuildMembersIntent) {
    logToFile(
      'Nie zresetowano rang PUBG: DISCORD_DISABLE_GUILD_MEMBERS_INTENT=true, ' +
      'wiec bot nie ma pelnej listy czlonkow do sprawdzenia.'
    );
    return false;
  }

  return true;
}

async function fetchGuildMembersPage(guild, after) {
  const query = new URLSearchParams({ limit: String(GUILD_MEMBERS_PAGE_SIZE) });
  if (after) query.set('after', after);

  return guild.client.rest.get(`/guilds/${guild.id}/members`, { query });
}

async function removeRankRolesFromGuildMembers(guild, rankRoles) {
  const rankRoleIds = new Set(rankRoles.map(role => role.id));
  const rankRoleNames = new Map(rankRoles.map(role => [role.id, role.name]));
  let after = null;
  let checkedMembers = 0;
  let removedRoles = 0;
  let failedRemovals = 0;

  while (true) {
    let members;
    try {
      members = await fetchGuildMembersPage(guild, after);
    } catch (error) {
      logToFile(`Nie zresetowano rang PUBG: nie udalo sie pobrac strony czlonkow (${error.message})`);
      return {
        checkedMembers,
        removedRoles,
        failedRemovals: failedRemovals + 1,
        fetchFailed: true
      };
    }

    if (!Array.isArray(members) || members.length === 0) break;

    for (const member of members) {
      const userId = member.user?.id;
      if (!userId) continue;

      checkedMembers += 1;
      const rolesToRemove = member.roles.filter(roleId => rankRoleIds.has(roleId));

      for (const roleId of rolesToRemove) {
        try {
          await guild.client.rest.delete(
            `/guilds/${guild.id}/members/${userId}/roles/${roleId}`,
            { reason: 'PUBG season rank reset' }
          );
          removedRoles += 1;
        } catch (error) {
          failedRemovals += 1;
          const roleName = rankRoleNames.get(roleId) || roleId;
          const tag = member.user?.username || userId;
          const message = `[pubgRanks] Nie moge usunac roli ${roleName} u ${tag}: ${error.message}`;
          console.error(message);
          logToFile(message);
        }
      }
    }

    const lastUserId = members[members.length - 1]?.user?.id;
    if (!lastUserId || members.length < GUILD_MEMBERS_PAGE_SIZE || lastUserId === after) break;
    after = lastUserId;
  }

  return {
    checkedMembers,
    removedRoles,
    failedRemovals,
    fetchFailed: false
  };
}

async function fetchPubgRank(nickname) {
  const player = await getPlayerByName(nickname);
  if (!player) throw new Error('Nie znaleziono gracza.');

  const seasonId = await getCurrentSeason();
  if (!seasonId) throw new Error('Nie znaleziono biezacego sezonu.');

  const rankData = await pubgRequest(
    `https://api.pubg.com/shards/${config.pubg.region}/players/${player.id}/seasons/${seasonId}/ranked`
  );

  const statsObj = rankData.data?.attributes?.rankedGameModeStats;
  if (!statsObj || Object.keys(statsObj).length === 0) {
    throw new Error('Nie rozegrano gier ranked w biezacym sezonie.');
  }

  let maxMatches = 0;
  let bestMode = null;
  let bestModeName = '';

  for (const mode in statsObj) {
    const stats = statsObj[mode];
    const rank = resolveRank(stats);
    if (stats.roundsPlayed === 0 || rank.tier === 'Unranked') continue;
    if (!bestMode || compareRankedModes(stats, bestMode) > 0) {
      bestMode = stats;
      bestModeName = mode;
      maxMatches = stats.roundsPlayed || 0;
    }
  }

  const rank = resolveRank(bestMode);
  if (!bestMode || rank.tier === 'Unranked') {
    throw new Error('Nie znaleziono rangi ranked.');
  }

  return {
    tier: rank.tier.toUpperCase(),
    rankTier: rank.tier,
    rankSubTier: rank.subTier,
    rankLabel: rank.label,
    rankPoints: rank.rankPoint,
    mode: bestModeName,
    matches: maxMatches
  };
}

async function resetRankRolesIfSeasonChanged(client) {
  const state = readJson(config.files.season, { currentSeason: null });
  const currentSeason = await getCurrentSeason().catch(error => {
    console.error('[pubgRanks] Blad pobierania sezonu:', error.message);
    return null;
  });

  if (!currentSeason) return;

  const guild = await client.guilds.fetch(config.discord.guildId).catch(() => null);
  if (!guild) return;

  await guild.roles.fetch().catch(() => null);

  const isNewSeason = currentSeason !== state.currentSeason;
  const rankResetDone = state.rankResetSeason === currentSeason;
  if (!isNewSeason && rankResetDone) return;

  const channel = guild.channels.cache.find(item =>
    item.name === config.discord.generalChannelName && item.isTextBased()
  );

  const canReset = canResetRankRoles();
  if (!canReset) {
    if (isNewSeason) {
      await channel?.send(
        `Wykryto nowy sezon PUBG: **${currentSeason}**, ale nie moge zresetowac rol rang ` +
        'bez wlaczonego Guild Members Intent.'
      );
      writeJson(config.files.season, { ...state, currentSeason });
    }
    return;
  }

  if (fs.existsSync(config.files.statsCache)) {
    fs.unlinkSync(config.files.statsCache);
  }

  if (isNewSeason) {
    await channel?.send(`Wykryto nowy sezon PUBG: **${currentSeason}**. Resetuje role rang.`);
  } else {
    await channel?.send(`Ponawiam reset rol rang PUBG dla sezonu **${currentSeason}**.`);
  }

  const rankRoles = guild.roles.cache.filter(role => RANK_ROLE_NAMES.has(role.name.toUpperCase()));
  if (rankRoles.size === 0) {
    writeJson(config.files.season, { ...state, currentSeason });
    logToFile(`Nie zresetowano rang PUBG dla sezonu ${currentSeason}: nie znaleziono rol rang na serwerze.`);
    await channel?.send(
      `Nie udalo sie dokonczyc resetu rol rang PUBG dla sezonu **${currentSeason}**: ` +
      'nie znalazlem rol rang na serwerze.'
    );
    return;
  }

  const resetResult = await removeRankRolesFromGuildMembers(guild, [...rankRoles.values()]);

  if (resetResult.failedRemovals === 0) {
    writeJson(config.files.season, {
      ...state,
      currentSeason,
      rankResetSeason: currentSeason,
      rankResetAt: new Date().toISOString(),
      rankRolesRemoved: resetResult.removedRoles,
      rankResetMembersChecked: resetResult.checkedMembers
    });
    logToFile(
      `Reset rang PUBG po wykryciu sezonu ${currentSeason}; ` +
      `sprawdzono czlonkow: ${resetResult.checkedMembers}; usunieto rol: ${resetResult.removedRoles}`
    );
    if (!isNewSeason) {
      await channel?.send(
        `Reset rol rang PUBG dla sezonu **${currentSeason}** zakonczony. ` +
        `Usunieto rol: **${resetResult.removedRoles}**.`
      );
    }
  } else {
    writeJson(config.files.season, { ...state, currentSeason });
    logToFile(
      `Reset rang PUBG dla sezonu ${currentSeason} nie zostal oznaczony jako zakonczony; ` +
      `bledy zdejmowania rol: ${resetResult.failedRemovals}`
    );
    await channel?.send(
      `Nie udalo sie dokonczyc resetu rol rang PUBG dla sezonu **${currentSeason}**. ` +
      'Szczegoly sa w logach bota.'
    );
  }
}

function setupPubgRanks(client) {
  client.once('clientReady', async () => {
    await resetRankRolesIfSeasonChanged(client);
    setInterval(() => resetRankRolesIfSeasonChanged(client), 60 * 60 * 1000);
  });
}

module.exports = {
  setupPubgRanks,
  ensureRole,
  fetchPubgRank,
  resetRankRolesIfSeasonChanged
};
