// Synchronizuje usuniecie wydarzenia Discord z WordPressem.
const { deleteScheduledEventFromWP } = require('../utils/wpScheduledEvents');

module.exports = {
  name: 'guildScheduledEventDelete',
  async execute(event) {
    try {
      await deleteScheduledEventFromWP(event);
      console.log(`[events] Event "${event.name}" usuniety z WP`);
    } catch (error) {
      console.error('[events] Blad usuwania WP:', error.response?.data || error.message);
    }
  }
};
