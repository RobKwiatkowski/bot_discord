const {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');
const {
  addInputFromInteraction,
  clipText,
  getGuildPlayer,
  getSettings,
  publishPanel,
  showQueue,
  showSearchResults,
  updateMusicSettings,
  updatePanel
} = require('../src/features/music');

const EPHEMERAL_FLAGS = 64;

function canManageMusic(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

function assertAllowedMusicChannel(interaction) {
  const settings = getSettings();
  if (settings.textChannelId && interaction.channelId !== settings.textChannelId) {
    throw new Error(`Muzyke obslugujemy na kanale <#${settings.textChannelId}>.`);
  }
}

function formatSettings(settings) {
  return [
    `kanal panelu: ${settings.textChannelId ? `<#${settings.textChannelId}>` : 'nie ustawiono'}`,
    `kanal glosowy: ${settings.voiceChannelId ? `<#${settings.voiceChannelId}>` : 'wedlug uzytkownika'}`,
    `maks. kolejka: ${settings.maxQueueSize}`,
    `wyniki wyszukiwania: ${settings.searchLimit}`,
    `auto-rozlaczenie: ${Math.round(settings.idleDisconnectMs / 1000)} s`
  ].join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('muzyka')
    .setDescription('Odtwarzanie muzyki na kanale glosowym')
    .addSubcommand(sub =>
      sub
        .setName('graj')
        .setDescription('Dodaje utwor, link YouTube/Spotify albo playliste do kolejki')
        .addStringOption(option =>
          option
            .setName('utwor')
            .setDescription('Nazwa utworu, link YouTube albo link Spotify')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('szukaj')
        .setDescription('Pokazuje wyniki wyszukiwania do wyboru')
        .addStringOption(option =>
          option
            .setName('utwor')
            .setDescription('Nazwa utworu')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('panel')
        .setDescription('Publikuje panel sterowania muzyka')
        .addChannelOption(option =>
          option
            .setName('kanal')
            .setDescription('Kanal tekstowy na panel')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('kolejka')
        .setDescription('Pokazuje aktualna kolejke')
    )
    .addSubcommand(sub =>
      sub
        .setName('pauza')
        .setDescription('Wstrzymuje odtwarzanie')
    )
    .addSubcommand(sub =>
      sub
        .setName('wznow')
        .setDescription('Wznawia odtwarzanie')
    )
    .addSubcommand(sub =>
      sub
        .setName('next')
        .setDescription('Pomija aktualny utwor')
    )
    .addSubcommand(sub =>
      sub
        .setName('stop')
        .setDescription('Zatrzymuje muzyke i czysci kolejke')
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Pokazuje status i ustawienia muzyki')
    )
    .addSubcommand(sub =>
      sub
        .setName('ustaw')
        .setDescription('Ustawia kanal glosowy, kanal panelu i limity')
        .addChannelOption(option =>
          option
            .setName('kanal_glosowy')
            .setDescription('Staly kanal glosowy dla muzyki')
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(false)
        )
        .addChannelOption(option =>
          option
            .setName('kanal_panelu')
            .setDescription('Kanal tekstowy do panelu i komend muzyki')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
        .addIntegerOption(option =>
          option
            .setName('maks_kolejka')
            .setDescription('Maksymalna liczba utworow w kolejce')
            .setMinValue(1)
            .setMaxValue(200)
            .setRequired(false)
        )
        .addIntegerOption(option =>
          option
            .setName('wyniki')
            .setDescription('Liczba wynikow wyszukiwania w panelu')
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: EPHEMERAL_FLAGS });

    try {
      const sub = interaction.options.getSubcommand();

      if (sub === 'graj') {
        const input = interaction.options.getString('utwor');
        const result = await addInputFromInteraction(interaction, input);
        const lines = [
          `Dodano: **${clipText(result.firstTrack.title, 120)}**`,
          result.added > 1 ? `Liczba dodanych utworow: ${result.added}` : null,
          result.spotifyNotice
            ? 'Spotify zostalo dopasowane po tytule i artyscie; audio gra z publicznego wyniku.'
            : null
        ].filter(Boolean);
        await interaction.editReply(lines.join('\n'));
        return;
      }

      if (sub === 'szukaj') {
        const query = interaction.options.getString('utwor');
        await showSearchResults(interaction, query);
        return;
      }

      if (sub === 'panel') {
        if (!canManageMusic(interaction)) {
          await interaction.editReply('Tylko osoby z Manage Server moga publikowac panel muzyki.');
          return;
        }

        const channel = interaction.options.getChannel('kanal') || interaction.channel;
        const message = await publishPanel(interaction, channel);
        await interaction.editReply(`Panel muzyki opublikowany: ${message.url}`);
        return;
      }

      if (sub === 'kolejka') {
        assertAllowedMusicChannel(interaction);
        await showQueue(interaction);
        return;
      }

      const player = getGuildPlayer(interaction.client, interaction.guildId);

      if (sub === 'pauza') {
        assertAllowedMusicChannel(interaction);
        player.pause();
        await updatePanel(interaction.client, interaction.guildId);
        await interaction.editReply('Pauza.');
        return;
      }

      if (sub === 'wznow') {
        assertAllowedMusicChannel(interaction);
        player.resume();
        await updatePanel(interaction.client, interaction.guildId);
        await interaction.editReply('Gram dalej.');
        return;
      }

      if (sub === 'next') {
        assertAllowedMusicChannel(interaction);
        player.skip();
        await interaction.editReply('Pomijam utwor.');
        return;
      }

      if (sub === 'stop') {
        assertAllowedMusicChannel(interaction);
        player.stop();
        await updatePanel(interaction.client, interaction.guildId);
        await interaction.editReply('Zatrzymano i wyczyszczono kolejke.');
        return;
      }

      if (sub === 'status') {
        const settings = getSettings();
        const current = player.current
          ? `teraz gra: ${player.current.title}`
          : 'teraz gra: nic';
        await interaction.editReply(`${current}\n${formatSettings(settings)}`);
        return;
      }

      if (sub === 'ustaw') {
        if (!canManageMusic(interaction)) {
          await interaction.editReply('Tylko osoby z Manage Server moga zmieniac ustawienia muzyki.');
          return;
        }

        const voiceChannel = interaction.options.getChannel('kanal_glosowy');
        const textChannel = interaction.options.getChannel('kanal_panelu');
        const maxQueueSize = interaction.options.getInteger('maks_kolejka');
        const searchLimit = interaction.options.getInteger('wyniki');

        const updates = {};
        if (voiceChannel) updates.voiceChannelId = voiceChannel.id;
        if (textChannel) updates.textChannelId = textChannel.id;
        if (maxQueueSize !== null) updates.maxQueueSize = maxQueueSize;
        if (searchLimit !== null) updates.searchLimit = searchLimit;

        if (Object.keys(updates).length === 0) {
          await interaction.editReply('Podaj przynajmniej jedno ustawienie.');
          return;
        }

        const settings = updateMusicSettings(updates);
        await updatePanel(interaction.client, interaction.guildId);
        await interaction.editReply(`Zapisano ustawienia muzyki:\n${formatSettings(settings)}`);
      }
    } catch (error) {
      console.error(`[music] Blad komendy /muzyka ${interaction.options.getSubcommand(false) || ''}:`, error);
      await interaction.editReply(error.message || 'Nie udalo sie wykonac komendy muzyki.');
    }
  }
};
