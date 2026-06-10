// Aktualizacja aktualnego poziomu klanu w WordPressie.
const axios = require('axios');
const { config } = require('../src/config');
const { readJson, writeJson } = require('../src/jsonStore');
const { pubgHeaders } = require('../src/pubgApi');
const { sendClanPromotionToWP } = require('../klan/wpClanPromotion');

async function fetchClanStats() {
  const response = await axios.get(
    `https://api.pubg.com/shards/${config.pubg.platform}/clans/${config.pubg.clanId}`,
    {
      headers: pubgHeaders(),
      timeout: 10000
    }
  );

  const attributes = response.data?.data?.attributes;
  if (!attributes || typeof attributes.clanLevel !== 'number') {
    throw new Error('PUBG API nie zwrocilo poziomu klanu');
  }

  return attributes;
}

function readPreviousLevel(fallbackLevel) {
  const previousStats = readJson(config.files.clanStats, null);
  const previousLevel = Number(previousStats?.clanLevel);

  return Number.isFinite(previousLevel) && previousLevel > 0
    ? previousLevel
    : fallbackLevel;
}

async function updateWordpressKlanLvl(level) {
  console.log('[levelklanu] updateWordpressKlanLvl START');

  const currentStats = await fetchClanStats();
  const newLevel = Number(level ?? currentStats.clanLevel);

  if (!Number.isFinite(newLevel) || newLevel <= 0) {
    throw new Error(`Nieprawidlowy poziom klanu: ${level}`);
  }

  const oldLevel = readPreviousLevel(newLevel);

  await sendClanPromotionToWP(oldLevel, newLevel, { throwOnError: true });

  writeJson(config.files.clanStats, {
    ...currentStats,
    clanLevel: newLevel,
    savedAt: new Date().toISOString()
  });

  console.log(`[levelklanu] updateWordpressKlanLvl OK: ${oldLevel} -> ${newLevel}`);

  return {
    clanName: currentStats.clanName,
    oldLevel,
    newLevel
  };
}

module.exports = updateWordpressKlanLvl;
