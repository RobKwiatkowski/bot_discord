// Synchronizuje aktualizacje wydarzenia Discord z WordPressem.
const { syncScheduledEventToWP } = require('../utils/wpScheduledEvents');

module.exports = {
  name: 'guildScheduledEventUpdate',
  async execute(oldEvent, newEvent) {
    console.log('[events] UPDATE:', newEvent.name);

    try {
      await syncScheduledEventToWP(newEvent);
      console.log(`[events] Event "${newEvent.name}" zaktualizowany w WP`);
    } catch (error) {
      console.error('[events] Blad aktualizacji WP:', error.response?.data || error.message);
    }
  }
};
