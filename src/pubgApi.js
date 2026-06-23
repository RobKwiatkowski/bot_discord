// Wspolny klient PUBG API. Dzieki temu funkcje rang, topki i poziomu klanu
// korzystaja z tych samych naglowkow oraz tej samej obslugi bledow.
const fetch = (...args) => import('node-fetch').then(({ default: fetchImpl }) => fetchImpl(...args));
const { config } = require('./config');

function pubgHeaders() {
  return {
    Authorization: `Bearer ${config.pubg.apiKey}`,
    Accept: 'application/vnd.api+json',
    'User-Agent': 'Sentinel Discord Bot'
  };
}

async function pubgRequest(url, options = {}) {
  if (!config.pubg.apiKey) {
    throw new Error('Brakuje PUBG_API_KEY w konfiguracji');
  }

  const res = await fetch(url, {
    ...options,
    headers: {
      ...pubgHeaders(),
      ...(options.headers || {})
    }
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const error = new Error(`PUBG API ${res.status}: ${res.statusText}`);
    error.status = res.status;
    error.retryAfter = res.headers.get('retry-after');
    throw error;
  }
  return res.json();
}

async function getCurrentSeason() {
  const data = await pubgRequest(`https://api.pubg.com/shards/${config.pubg.platform}/seasons`);
  const currentSeason = data.data.find(season =>
    season.attributes.isCurrentSeason && season.attributes.isOffseason === false
  );
  return currentSeason?.id || null;
}

async function getPlayerByName(nickname) {
  const data = await pubgRequest(
    `https://api.pubg.com/shards/${config.pubg.region}/players?filter[playerNames]=${encodeURIComponent(nickname)}`
  );
  return data?.data?.[0] || null;
}

async function getPlayersByNames(nicknames) {
  const uniqueNicknames = [...new Set(nicknames.map(name => String(name || '').trim()).filter(Boolean))];
  if (!uniqueNicknames.length) return [];

  const data = await pubgRequest(
    `https://api.pubg.com/shards/${config.pubg.region}/players?filter[playerNames]=${encodeURIComponent(uniqueNicknames.join(','))}`
  );

  return data?.data || [];
}

module.exports = {
  pubgHeaders,
  pubgRequest,
  getCurrentSeason,
  getPlayerByName,
  getPlayersByNames
};
