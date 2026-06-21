// Lista klanowiczow i TOP25 PUBG. Dane sa cache'owane w JSON, bo PUBG API ma limity.
const fs = require('fs');
const cron = require('node-cron');
const { config } = require('../config');
const { readJson, writeJson } = require('../jsonStore');
const { getCurrentSeason, getPlayerByName, pubgRequest } = require('../pubgApi');
const { compareRankedModes, resolveRank } = require('../pubgRankUtils');

const tierEmojis = {
  Bronze: '<:Bronze:1425601468039434250>',
  Silver: '<:Silver:1425601548213289093>',
  Gold: '<:Gold:1425601494815735951>',
  Platinum: '<:Platinum:1425601570502082632>',
  Diamond: '<:Diamond:1425601511815254217>',
  Crystal: '<:Crystal:1425601529406165113>'
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getPlayerRankedStats(playerId, seasonId) {
  return pubgRequest(
    `https://api.pubg.com/shards/${config.pubg.platform}/players/${playerId}/seasons/${seasonId}/ranked`
  );
}

async function generateTopka() {
  console.log('[pubgTop] Odswiezam cache PUBG...');
  const clanList = readJson(config.files.clanList, []);
  const statsCache = readJson(config.files.statsCache, {});
  const seasonId = await getCurrentSeason();
  const now = Date.now();
  const results = [];

  if (!seasonId) {
    console.log('[pubgTop] Nie udalo sie pobrac aktualnego sezonu.');
    return results;
  }

  for (const nick of clanList) {
    const cacheEntry = statsCache[nick];
    if (cacheEntry && now - cacheEntry.timestamp < config.pubg.statsCacheTtlMs) {
      results.push({ nick, ...cacheEntry.data });
      continue;
    }

    await delay(config.pubg.rankedRequestDelayMs);

    try {
      const player = await getPlayerByName(nick);
      if (!player) throw new Error('Nie znaleziono gracza');

      const stats = await getPlayerRankedStats(player.id, seasonId);
      const ranked = stats?.data?.attributes?.rankedGameModeStats;
      if (!ranked) throw new Error('Brak danych ranked');

      let totalMatches = 0;
      let bestMode = null;

      for (const mode of ['solo', 'duo', 'squad']) {
        for (const view of ['fpp', 'tpp']) {
          const modeData = ranked[`${mode}-${view}`];
          if (!modeData) continue;
          totalMatches += modeData.roundsPlayed || 0;
          if (!bestMode || compareRankedModes(modeData, bestMode) > 0) {
            bestMode = modeData;
          }
        }
      }

      if (!bestMode) throw new Error('Brak danych ranked TPP/FPP');

      const rank = resolveRank(bestMode);
      const tierEmoji = tierEmojis[rank.tier] || '';
      const playerData = {
        RP: rank.rankPoint || 0,
        tier: `${tierEmoji} ${rank.label}`.trim(),
        matches: totalMatches,
        wins: bestMode.wins || 0,
        kills: bestMode.kills || 0,
        deaths: bestMode.deaths || 0,
        KD: bestMode.deaths ? (bestMode.kills / bestMode.deaths).toFixed(2) : '0.00',
        winRate: totalMatches ? `${((bestMode.wins / totalMatches) * 100).toFixed(1)}%` : '0%'
      };

      statsCache[nick] = { timestamp: now, data: playerData };
      results.push({ nick, ...playerData });
      writeJson(config.files.statsCache, statsCache);
      console.log(`[pubgTop] ${nick} - ${playerData.RP} RP`);
    } catch (error) {
      console.log(`[pubgTop] ${nick}: ${error.message}`);
    }
  }

  const validMembers = new Set(clanList);
  for (const nick in statsCache) {
    if (!validMembers.has(nick)) delete statsCache[nick];
  }
  writeJson(config.files.statsCache, statsCache);
  return results;
}

async function renderTop25Buffer() {
  const data = readJson(config.files.statsCache, {});
  const results = Object.entries(data).map(([nick, entry]) => ({ nick, ...entry.data }));
  if (!results.length) {
    return null;
  }

  const { createCanvas, loadImage } = require('canvas');
  const width = 1400;
  const height = 1800;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  if (fs.existsSync(config.files.top25Background)) {
    const background = await loadImage(config.files.top25Background);
    ctx.drawImage(background, 0, 0, width, height);
  } else {
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, width, height);
  }

  results.sort((a, b) => b.RP - a.RP);
  const top25 = results.slice(0, 25);

  ctx.font = '24px monospace';
  ctx.fillStyle = '#ffffff';
  const startY = 350;
  const lineHeight = 55;

  top25.forEach((player, index) => {
    const pos = String(index + 1).padStart(2, ' ');
    const rp = String(player.RP).padStart(4, ' ');
    const kd = String(player.KD).padStart(4, ' ');
    const tierClean = String(player.tier).replace(/<:.+?:\d+>/g, '').trim();
    const line = `${pos}. ${player.nick.padEnd(16)} || ${rp} RP || ${tierClean} || K/D: ${kd} || Kurczaki: ${player.wins} ||`;
    ctx.fillText(line, 250, startY + index * lineHeight);
  });

  const buffer = canvas.toBuffer('image/png');
  return buffer;
}

async function sendTop25Image(message) {
  const buffer = await renderTop25Buffer();
  if (!buffer) {
    await message.reply('Brak danych w cache. Uzyj najpierw `/topka odswiez`.');
    return;
  }
  await message.channel.send({ files: [{ attachment: buffer, name: 'top25.png' }] });
}

function setupPubgTop(client) {
  cron.schedule('0 5,16 * * *', () => {
    generateTopka().catch(error => console.error('[pubgTop] Blad cron:', error));
  });
}

module.exports = {
  setupPubgTop,
  generateTopka,
  renderTop25Buffer
};
