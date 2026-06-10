// Wysyla informacje o poziomie klanu do WordPressa.
const fetch = (...args) => import('node-fetch').then(({ default: fetchImpl }) => fetchImpl(...args));
const { config } = require('../src/config');

const WP_PROMO_URL = config.wordpress.clanPromotionEndpoint;

async function readResponseBody(res) {
  const text = await res.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function createWpError(status, body) {
  const details = typeof body === 'string' ? body : JSON.stringify(body);
  return new Error(`WordPress ${status}: ${details}`);
}

async function sendClanPromotionToWP(oldLevel, newLevel, options = {}) {
  const throwOnError = options.throwOnError === true;

  try {
    if (!WP_PROMO_URL) {
      throw new Error('Brakuje WP_CLAN_PROMOTION_ENDPOINT w konfiguracji');
    }

    const res = await fetch(WP_PROMO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        game: 'PUBG',
        old_level: oldLevel,
        new_level: newLevel
      })
    });

    const body = await readResponseBody(res);

    if (!res.ok) {
      throw createWpError(res.status, body);
    }

    console.log(`[WP] Poziom klanu wyslany: ${oldLevel} -> ${newLevel}`);
    return body || { status: 'ok' };
  } catch (err) {
    console.error('[WP] Blad wysylki poziomu klanu:', err.message);
    if (throwOnError) throw err;
    return false;
  }
}

module.exports = { sendClanPromotionToWP };
