// Wspolna synchronizacja wydarzen Discorda z WordPressem.
const axios = require('axios');
const { config } = require('../src/config');

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function endpointUrl(path) {
  const baseUrl = trimSlash(config.wordpress.eventsUrl);
  const cleanPath = `/${String(path || '').replace(/^\/+/, '')}`;

  if (!baseUrl) return '';

  if (cleanPath === '/event' && /\/event$/i.test(baseUrl)) {
    return baseUrl;
  }

  if (cleanPath === '/event-delete' && /\/event$/i.test(baseUrl)) {
    return baseUrl.replace(/\/event$/i, '/event-delete');
  }

  if (cleanPath === '/event-delete' && /\/event-delete$/i.test(baseUrl)) {
    return baseUrl;
  }

  return `${baseUrl}${cleanPath}`;
}

function eventUrl(event) {
  return event.url || `https://discord.com/events/${event.guildId}/${event.id}`;
}

function eventImageUrl(event) {
  if (typeof event.coverImageURL === 'function') {
    const url = event.coverImageURL({ size: 1024 });
    if (url) return url;
  }

  if (event.image) {
    return `https://cdn.discordapp.com/guild-events/${event.id}/${event.image}.png`;
  }

  return null;
}

async function eventCreator(event) {
  let creator = event.creator || null;

  if (!creator && event.creatorId && event.client?.users?.fetch) {
    creator = await event.client.users.fetch(event.creatorId).catch(() => null);
  }

  if (!creator) {
    return {
      id: event.creatorId || null,
      username: null,
      tag: null,
      avatarUrl: null
    };
  }

  return {
    id: creator.id,
    username: creator.username,
    tag: creator.tag || creator.username,
    avatarUrl: creator.displayAvatarURL({ extension: 'png', size: 64 })
  };
}

async function buildScheduledEventPayload(event) {
  const creator = await eventCreator(event);

  return {
    id: event.id,
    guild_id: event.guildId,
    channel_id: event.channelId || null,
    title: event.name,
    description: event.description || '',
    start_at: event.scheduledStartAt?.toISOString() || null,
    end_at: event.scheduledEndAt?.toISOString() || null,
    count: event.userCount || 0,
    image: eventImageUrl(event),
    link: eventUrl(event),
    creator,
    location: event.entityMetadata?.location || '',
    status: event.status || null,
    entity_type: event.entityType || null
  };
}

async function postToWordpress(path, payload) {
  const url = endpointUrl(path);
  if (!url) {
    console.warn('[WP events] Brakuje WP_EVENTS_URL - pomijam synchronizacje.');
    return null;
  }

  const headers = {
    'Content-Type': 'application/json'
  };

  if (config.wordpress.eventsToken) {
    headers.Authorization = `Bearer ${config.wordpress.eventsToken}`;
  }

  console.log(`[WP events] POST ${url}`);

  const response = await axios.post(url, payload, {
    headers,
    timeout: 10000
  });

  return response.data;
}

async function syncScheduledEventToWP(event) {
  const payload = await buildScheduledEventPayload(event);
  return postToWordpress('/event', payload);
}

async function deleteScheduledEventFromWP(event) {
  return postToWordpress('/event-delete', {
    id: event.id,
    event_id: event.id,
    link: eventUrl(event)
  });
}

module.exports = {
  syncScheduledEventToWP,
  deleteScheduledEventFromWP
};
