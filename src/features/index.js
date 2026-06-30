// Jedna lista modulow funkcjonalnych. Glowny plik startowy tylko ja przechodzi
// i odpala setup, zamiast trzymac wszystkie listenery w jednym monolicie.
const { setupPubgRanks } = require('./pubgRanks');
const { setupPubgTop } = require('./pubgTop');
const { setupMessageLogger } = require('./messageLogger');
const { setupStreams } = require('./streams');
const { setupAutoRole } = require('./autoRole');
const { setupNewAccountAlerts } = require('./newAccountAlerts');
const { setupAntiSpam } = require('./antiSpam');
const { setupStandardVoiceRooms } = require('./standardVoiceRooms');
const { setupGameVoiceRooms } = require('./gameVoiceRooms');
const { setupTickets } = require('./tickets');
const { setupYoutube } = require('./youtube');
const { setupVoiceLogs } = require('./voiceLogs');
const { setupMemberLeaveLogs } = require('./memberLeaveLogs');
const { setupEmptyVoiceCleanup } = require('./emptyVoiceCleanup');
const { setupAnniversaries } = require('./anniversaries');
const { setupClanLevelMonitor } = require('./clanLevelMonitor');
const { setupPubgChickenDinners } = require('./pubgChickenDinners');
const { setupBoostThanks } = require('./boostThanks');
const { setupPresence } = require('./presence');
const { setupTipply } = require('./tipply');
const { setupGameDeals } = require('./gameDeals');
const { setupMusic } = require('./music');
const { setupDiscordStats } = require('./discordStats');
const { config } = require('../config');

const features = [
  setupPubgRanks,
  setupPubgTop,
  setupStreams,
  setupStandardVoiceRooms,
  setupGameVoiceRooms,
  setupTickets,
  setupYoutube,
  setupVoiceLogs,
  setupEmptyVoiceCleanup,
  setupClanLevelMonitor,
  setupPubgChickenDinners,
  setupBoostThanks,
  setupPresence,
  setupTipply,
  setupGameDeals,
  setupMusic,
  setupDiscordStats
];

const guildMembersFeatures = [
  ['autoRole', setupAutoRole],
  ['newAccountAlerts', setupNewAccountAlerts],
  ['memberLeaveLogs', setupMemberLeaveLogs],
  ['anniversaries', setupAnniversaries]
];

const messageContentFeatures = [
  ['antiSpam', setupAntiSpam],
  ['messageLogger', setupMessageLogger]
];

function setupFeatures(client) {
  for (const setup of features) {
    setup(client);
  }

  if (config.discord.enableGuildMembersIntent) {
    for (const [, setup] of guildMembersFeatures) {
      setup(client);
    }
  } else {
    console.warn(
      `[features] Pomijam funkcje wymagajace Guild Members Intent: ` +
      guildMembersFeatures.map(([name]) => name).join(', ')
    );
  }

  if (config.discord.enableMessageContentIntent) {
    for (const [, setup] of messageContentFeatures) {
      setup(client);
    }
  } else {
    console.warn(
      `[features] Pomijam funkcje wymagajace Message Content Intent: ` +
      messageContentFeatures.map(([name]) => name).join(', ')
    );
  }
}

module.exports = { setupFeatures };
