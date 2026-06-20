// Fabryka klienta Discord. Intencje sa w jednym miejscu, bo od nich zalezy,
// ktore eventy Discord wysyla do naszego bota.
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { config } = require('./config');

function createDiscordClient() {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildScheduledEvents
  ];

  if (config.discord.enableGuildMembersIntent) {
    intents.push(GatewayIntentBits.GuildMembers);
  } else {
    console.warn(
      '[discord] DISCORD_DISABLE_GUILD_MEMBERS_INTENT=true: pomijam funkcje zalezne od listy czlonkow.'
    );
  }

  if (config.discord.enableMessageContentIntent) {
    intents.push(GatewayIntentBits.MessageContent);
  } else {
    console.warn(
      '[discord] DISCORD_ENABLE_MESSAGE_CONTENT_INTENT=false: tresc zwyklych wiadomosci nie bedzie czytana.'
    );
  }

  return new Client({
    intents,
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.Reaction
    ]
  });
}

module.exports = { createDiscordClient };
