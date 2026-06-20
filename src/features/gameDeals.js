const axios = require('axios');
const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const { config } = require('../config');
const { readJson, writeJson } = require('../jsonStore');

const CHEAPSHARK_API = 'https://www.cheapshark.com/api/1.0';
const EPIC_FREE_GAMES_API = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions';

let cheapSharkStoresCache = null;
let isChecking = false;

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 120);
}

function readState() {
  const state = readJson(config.files.gameDeals, {
    settings: {},
    seenOffers: {},
    lastCheckedAt: null
  });

  return {
    settings: state.settings && typeof state.settings === 'object' ? state.settings : {},
    seenOffers: state.seenOffers && typeof state.seenOffers === 'object' ? state.seenOffers : {},
    lastCheckedAt: state.lastCheckedAt || null
  };
}

function getSettings(state = readState()) {
  return {
    enabled: state.settings.enabled ?? config.gameDeals.enabled,
    channelId: state.settings.channelId || config.gameDeals.channelId,
    cron: state.settings.cron || config.gameDeals.cron,
    timezone: state.settings.timezone || config.gameDeals.timezone,
    runOnStart: state.settings.runOnStart ?? config.gameDeals.runOnStart,
    minDiscount: clampNumber(state.settings.minDiscount, 0, 100, config.gameDeals.minDiscount),
    maxPrice: clampNumber(state.settings.maxPrice, 0, 10000, config.gameDeals.maxPrice),
    maxPostsPerRun: clampNumber(state.settings.maxPostsPerRun, 1, 25, config.gameDeals.maxPostsPerRun),
    maxSeenOffers: clampNumber(state.settings.maxSeenOffers, 100, 10000, config.gameDeals.maxSeenOffers),
    locale: state.settings.locale || config.gameDeals.locale,
    country: state.settings.country || config.gameDeals.country
  };
}

function writeState(state) {
  writeJson(config.files.gameDeals, state);
}

function updateGameDealsSettings(updates) {
  const state = readState();
  state.settings = {
    ...state.settings,
    ...updates
  };
  writeState(state);
  return getSettings(state);
}

function resetSeenOffers() {
  const state = readState();
  state.seenOffers = {};
  state.lastCheckedAt = null;
  writeState(state);
}

function getGameDealsStatus() {
  const state = readState();
  const settings = getSettings(state);
  return {
    settings,
    seenCount: Object.keys(state.seenOffers).length,
    lastCheckedAt: state.lastCheckedAt
  };
}

async function fetchCheapSharkStores() {
  if (cheapSharkStoresCache) return cheapSharkStoresCache;

  const response = await axios.get(`${CHEAPSHARK_API}/stores`, {
    timeout: 10000
  });

  cheapSharkStoresCache = Array.isArray(response.data) ? response.data : [];
  return cheapSharkStoresCache;
}

function findCheapSharkTargets(stores) {
  const activeStores = stores.filter(store => String(store.isActive) !== '0');
  const steam = activeStores.find(store => String(store.storeName || '').toLowerCase() === 'steam');
  const epic = activeStores.find(store => String(store.storeName || '').toLowerCase().includes('epic'));

  return [
    {
      key: 'steam',
      label: 'Steam',
      storeId: steam?.storeID || '1'
    },
    {
      key: 'epic',
      label: 'Epic Games Store',
      storeId: epic?.storeID || '25'
    }
  ];
}

function formatCheapSharkPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price)) return 'brak ceny';
  if (price <= 0) return '0.00 USD';
  return `${price.toFixed(2)} USD`;
}

function normalizeCheapSharkDeal(deal, target, settings) {
  const normalPrice = Number(deal.normalPrice);
  const salePrice = Number(deal.salePrice);
  const discountPercent = Math.round(Number(deal.savings || 0));

  if (!Number.isFinite(normalPrice) || !Number.isFinite(salePrice)) return null;
  if (normalPrice <= 0 || salePrice >= normalPrice) return null;

  const isFree = salePrice <= 0;
  if (!isFree && discountPercent < settings.minDiscount) return null;

  const steamAppId = deal.steamAppID ? String(deal.steamAppID) : '';
  const storeKey = target.key;
  const dedupeId = storeKey === 'steam' && steamAppId ? steamAppId : normalizeTitle(deal.title);

  return {
    dedupeKey: `${storeKey}:${dedupeId}`,
    source: target.label,
    sourceKey: storeKey,
    title: deal.title,
    description: 'Promocja znaleziona przez CheapShark.',
    originalPrice: formatCheapSharkPrice(normalPrice),
    salePrice: formatCheapSharkPrice(salePrice),
    discountPercent,
    isFree,
    image: deal.thumb || null,
    url: steamAppId
      ? `https://store.steampowered.com/app/${steamAppId}`
      : `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(deal.dealID)}`,
    steamAppId,
    endsAt: null
  };
}

async function enrichSteamOffers(offers, settings) {
  const steamOffers = offers.filter(offer => offer.sourceKey === 'steam' && offer.steamAppId);

  await Promise.allSettled(steamOffers.map(async offer => {
    const response = await axios.get('https://store.steampowered.com/api/appdetails', {
      params: {
        appids: offer.steamAppId,
        filters: 'basic,price_overview',
        l: 'polish',
        cc: settings.country
      },
      timeout: 10000
    });

    const app = response.data?.[offer.steamAppId];
    if (!app?.success || !app.data) return;

    if (app.data.short_description) {
      offer.description = app.data.short_description;
    }

    if (app.data.header_image) {
      offer.image = app.data.header_image;
    }

    if (app.data.price_overview) {
      const price = app.data.price_overview;
      offer.discountPercent = Number(price.discount_percent) || offer.discountPercent;
      offer.originalPrice = price.initial_formatted || offer.originalPrice;
      offer.salePrice = price.final === 0 ? '0' : price.final_formatted || offer.salePrice;
      offer.isFree = Number(price.final) === 0;
    }
  }));

  return offers;
}

async function fetchCheapSharkDeals(settings) {
  const stores = await fetchCheapSharkStores();
  const targets = findCheapSharkTargets(stores);
  const pageSize = Math.min(60, Math.max(20, settings.maxPostsPerRun * 4));
  const offers = [];

  for (const target of targets) {
    const response = await axios.get(`${CHEAPSHARK_API}/deals`, {
      params: {
        storeID: target.storeId,
        lowerPrice: 0,
        upperPrice: settings.maxPrice,
        sortBy: 'Savings',
        desc: 1,
        pageSize
      },
      timeout: 10000
    });

    for (const deal of Array.isArray(response.data) ? response.data : []) {
      const offer = normalizeCheapSharkDeal(deal, target, settings);
      if (offer) offers.push(offer);
    }
  }

  return enrichSteamOffers(offers, settings);
}

function getEpicImage(item) {
  const images = Array.isArray(item.keyImages) ? item.keyImages : [];
  const preferredTypes = ['OfferImageWide', 'DieselStoreFrontWide', 'Thumbnail', 'DieselStoreFrontTall'];

  for (const type of preferredTypes) {
    const image = images.find(entry => entry.type === type && entry.url);
    if (image) return image.url;
  }

  return images.find(entry => entry.url)?.url || null;
}

function getEpicSlug(item) {
  if (item.productSlug) return item.productSlug;
  if (item.urlSlug) return item.urlSlug;

  const mappings = item.catalogNs?.mappings;
  if (Array.isArray(mappings)) {
    const page = mappings.find(mapping => mapping.pageSlug);
    if (page) return page.pageSlug;
  }

  return null;
}

function getEpicPromotion(item) {
  const promotions = item.promotions?.promotionalOffers;
  if (!Array.isArray(promotions)) return null;

  const now = Date.now();
  for (const group of promotions) {
    for (const promo of Array.isArray(group.promotionalOffers) ? group.promotionalOffers : []) {
      const startAt = Date.parse(promo.startDate || '');
      const endAt = Date.parse(promo.endDate || '');
      if (Number.isFinite(startAt) && Number.isFinite(endAt) && startAt <= now && now <= endAt) {
        return promo;
      }
    }
  }

  return null;
}

function normalizeEpicFreeGame(item, settings) {
  const totalPrice = item.price?.totalPrice;
  const original = Number(totalPrice?.originalPrice);
  const discounted = Number(totalPrice?.discountPrice);
  const promotion = getEpicPromotion(item);

  if (!promotion || !Number.isFinite(original) || !Number.isFinite(discounted)) return null;
  if (original <= 0 || discounted !== 0) return null;

  const slug = getEpicSlug(item);
  const language = String(settings.locale || 'pl-PL').split('-')[0] || 'pl';
  const url = slug
    ? `https://store.epicgames.com/${language}/p/${slug}`
    : 'https://store.epicgames.com/free-games';

  return {
    dedupeKey: `epic:${normalizeTitle(item.title)}`,
    source: 'Epic Games Store',
    sourceKey: 'epic',
    title: item.title,
    description: item.description || 'Darmowa oferta w Epic Games Store.',
    originalPrice: totalPrice.fmtPrice?.originalPrice || 'brak ceny',
    salePrice: totalPrice.fmtPrice?.discountPrice || '0',
    discountPercent: 100,
    isFree: true,
    image: getEpicImage(item),
    url,
    steamAppId: '',
    endsAt: promotion.endDate || null
  };
}

async function fetchEpicFreeGames(settings) {
  const response = await axios.get(EPIC_FREE_GAMES_API, {
    params: {
      locale: settings.locale,
      country: settings.country,
      allowCountries: settings.country
    },
    timeout: 10000
  });

  const elements = response.data?.data?.Catalog?.searchStore?.elements;
  if (!Array.isArray(elements)) return [];

  return elements
    .map(item => normalizeEpicFreeGame(item, settings))
    .filter(Boolean);
}

function uniqueOffers(offers) {
  const seen = new Set();
  const unique = [];

  for (const offer of offers) {
    if (!offer.dedupeKey || seen.has(offer.dedupeKey)) continue;
    seen.add(offer.dedupeKey);
    unique.push(offer);
  }

  return unique.sort((a, b) => {
    if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
    return b.discountPercent - a.discountPercent || a.title.localeCompare(b.title, 'pl');
  });
}

async function fetchGameDeals(settings) {
  const results = await Promise.allSettled([
    fetchCheapSharkDeals(settings),
    fetchEpicFreeGames(settings)
  ]);

  const offers = [];
  const errors = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      offers.push(...result.value);
    } else {
      errors.push(result.reason?.message || String(result.reason));
    }
  }

  if (offers.length === 0 && errors.length > 0) {
    throw new Error(errors.join('; '));
  }

  for (const error of errors) {
    console.warn(`[gameDeals] Czesc ofert nie zostala pobrana: ${error}`);
  }

  return uniqueOffers(offers);
}

function clipText(text, maxLength) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 3)}...`;
}

function formatOfferPrice(offer) {
  if (offer.isFree) {
    return `${offer.originalPrice} -> za darmo`;
  }

  return `${offer.originalPrice} -> ${offer.salePrice}`;
}

function buildOfferEmbed(offer) {
  const embed = new EmbedBuilder()
    .setColor(offer.isFree ? 0x2ECC71 : 0xF1C40F)
    .setAuthor({ name: offer.source })
    .setTitle(clipText(offer.title, 256))
    .setURL(offer.url)
    .setDescription(clipText(offer.description, 1200) || 'Brak opisu.')
    .addFields(
      {
        name: 'Cena',
        value: clipText(formatOfferPrice(offer), 1024),
        inline: true
      },
      {
        name: 'Przecena',
        value: `${offer.discountPercent}%`,
        inline: true
      },
      {
        name: 'Link',
        value: `[Otworz w sklepie](${offer.url})`,
        inline: false
      }
    )
    .setFooter({
      text: offer.endsAt
        ? `Oferta do: ${new Date(offer.endsAt).toLocaleString('pl-PL')}`
        : 'Promocje gier'
    })
    .setTimestamp();

  if (offer.image) {
    embed.setImage(offer.image);
  }

  return embed;
}

async function getAnnouncementChannel(client, channelId) {
  if (!channelId) return null;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  return channel;
}

function trimSeenOffers(state, maxSeenOffers) {
  const entries = Object.entries(state.seenOffers);
  if (entries.length <= maxSeenOffers) return;

  entries.sort((a, b) => {
    const aDate = Date.parse(a[1]?.seenAt || '') || 0;
    const bDate = Date.parse(b[1]?.seenAt || '') || 0;
    return bDate - aDate;
  });

  state.seenOffers = Object.fromEntries(entries.slice(0, maxSeenOffers));
}

async function checkGameDeals(client, options = {}) {
  if (isChecking) {
    return {
      status: 'busy',
      found: 0,
      fresh: 0,
      sent: 0
    };
  }

  isChecking = true;

  try {
    const state = readState();
    const settings = getSettings(state);
    const channelId = options.channelId || settings.channelId;

    if (!settings.enabled && !options.force) {
      return {
        status: 'disabled',
        found: 0,
        fresh: 0,
        sent: 0
      };
    }

    const channel = await getAnnouncementChannel(client, channelId);
    if (!channel) {
      return {
        status: 'missing_channel',
        found: 0,
        fresh: 0,
        sent: 0
      };
    }

    const offers = await fetchGameDeals(settings);
    const freshOffers = offers.filter(offer => !state.seenOffers[offer.dedupeKey]);
    const offersToSend = freshOffers.slice(0, settings.maxPostsPerRun);
    const sendKeys = new Set(offersToSend.map(offer => offer.dedupeKey));
    const sentKeys = new Set();

    for (const offer of offersToSend) {
      await channel.send({ embeds: [buildOfferEmbed(offer)] });
      sentKeys.add(offer.dedupeKey);
    }

    const checkedAt = new Date().toISOString();
    for (const offer of offers) {
      if (state.seenOffers[offer.dedupeKey]) continue;
      if (sendKeys.has(offer.dedupeKey) && !sentKeys.has(offer.dedupeKey)) continue;

      state.seenOffers[offer.dedupeKey] = {
        title: offer.title,
        source: offer.source,
        discountPercent: offer.discountPercent,
        seenAt: checkedAt
      };
    }

    state.lastCheckedAt = checkedAt;
    trimSeenOffers(state, settings.maxSeenOffers);
    writeState(state);

    return {
      status: 'ok',
      found: offers.length,
      fresh: freshOffers.length,
      sent: sentKeys.size,
      channelId: channel.id
    };
  } finally {
    isChecking = false;
  }
}

function setupGameDeals(client) {
  client.once('clientReady', () => {
    const state = readState();
    const settings = getSettings(state);

    if (!settings.enabled) {
      console.log('[gameDeals] Modul promocji jest wylaczony.');
    }

    if (settings.enabled && settings.runOnStart) {
      checkGameDeals(client).catch(error => console.error('[gameDeals] Blad:', error.message));
    }

    if (cron.validate(settings.cron)) {
      cron.schedule(settings.cron, () => {
        checkGameDeals(client).catch(error => console.error('[gameDeals] Blad:', error.message));
      }, {
        timezone: settings.timezone
      });
      console.log(`[gameDeals] Harmonogram: ${settings.cron} (${settings.timezone}).`);
    } else {
      console.warn(`[gameDeals] Nieprawidlowy GAME_DEALS_CRON: ${settings.cron}`);
    }
  });
}

module.exports = {
  setupGameDeals,
  checkGameDeals,
  fetchGameDeals,
  getGameDealsStatus,
  updateGameDealsSettings,
  resetSeenOffers
};
