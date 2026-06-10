// Synchronizuje utworzenie wydarzenia Discord z WordPressem.
const { syncScheduledEventToWP } = require('../utils/wpScheduledEvents');

module.exports = {
  name: 'guildScheduledEventCreate',
  async execute(event) {
    console.log('[events] CREATE:', event.name);

    try {
      await syncScheduledEventToWP(event);
      console.log(`[events] Event "${event.name}" wyslany do WP`);
    } catch (error) {
      console.error('[events] Blad WP:', error.response?.data || error.message);
    }
  }
};
