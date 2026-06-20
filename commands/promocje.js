const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const {
  checkGameDeals,
  getGameDealsStatus,
  resetSeenOffers,
  updateGameDealsSettings
} = require('../src/features/gameDeals');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('promocje')
    .setDescription('Powiadomienia o darmowych i mocno przecenionych grach')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub
        .setName('ustaw')
        .setDescription('Ustawia kanal i prog przeceny')
        .addChannelOption(option =>
          option
            .setName('kanal')
            .setDescription('Kanal na powiadomienia')
            .setRequired(false)
        )
        .addIntegerOption(option =>
          option
            .setName('min_procent')
            .setDescription('Minimalna przecena dla platnych gier')
            .setMinValue(0)
            .setMaxValue(100)
            .setRequired(false)
        )
        .addNumberOption(option =>
          option
            .setName('max_cena')
            .setDescription('Maksymalna cena po przecenie w CheapShark (USD)')
            .setMinValue(0)
            .setRequired(false)
        )
        .addIntegerOption(option =>
          option
            .setName('limit')
            .setDescription('Maksymalna liczba embedow na jedno sprawdzenie')
            .setMinValue(1)
            .setMaxValue(25)
            .setRequired(false)
        )
        .addBooleanOption(option =>
          option
            .setName('wlaczone')
            .setDescription('Wlacza albo wylacza automatyczne sprawdzanie')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('sprawdz')
        .setDescription('Od razu sprawdza nowe promocje')
        .addChannelOption(option =>
          option
            .setName('kanal')
            .setDescription('Jednorazowy kanal wysylki')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Pokazuje aktualne ustawienia promocji')
    )
    .addSubcommand(sub =>
      sub
        .setName('reset')
        .setDescription('Czysci pamiec wyslanych gier')
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const sub = interaction.options.getSubcommand();

    if (sub === 'ustaw') {
      const updates = {};
      const channel = interaction.options.getChannel('kanal');
      const minDiscount = interaction.options.getInteger('min_procent');
      const maxPrice = interaction.options.getNumber('max_cena');
      const maxPostsPerRun = interaction.options.getInteger('limit');
      const enabled = interaction.options.getBoolean('wlaczone');

      if (channel) {
        if (!channel.isTextBased()) {
          await interaction.editReply('Wybrany kanal nie obsluguje wiadomosci tekstowych.');
          return;
        }
        updates.channelId = channel.id;
      }

      if (minDiscount !== null) updates.minDiscount = minDiscount;
      if (maxPrice !== null) updates.maxPrice = maxPrice;
      if (maxPostsPerRun !== null) updates.maxPostsPerRun = maxPostsPerRun;
      if (enabled !== null) updates.enabled = enabled;

      if (Object.keys(updates).length === 0) {
        await interaction.editReply('Podaj przynajmniej jedno ustawienie.');
        return;
      }

      const settings = updateGameDealsSettings(updates);
      await interaction.editReply(
        [
          'Zapisano ustawienia promocji:',
          `kanal: ${settings.channelId ? `<#${settings.channelId}>` : 'brak'}`,
          `min. przecena: ${settings.minDiscount}%`,
          `max cena CheapShark: ${settings.maxPrice} USD`,
          `limit: ${settings.maxPostsPerRun}`,
          `wlaczone: ${settings.enabled ? 'tak' : 'nie'}`
        ].join('\n')
      );
      return;
    }

    if (sub === 'sprawdz') {
      const channel = interaction.options.getChannel('kanal');
      if (channel && !channel.isTextBased()) {
        await interaction.editReply('Wybrany kanal nie obsluguje wiadomosci tekstowych.');
        return;
      }

      const result = await checkGameDeals(interaction.client, {
        channelId: channel?.id,
        force: true
      });

      if (result.status === 'missing_channel') {
        await interaction.editReply('Najpierw ustaw kanal: `/promocje ustaw kanal:#kanal`.');
        return;
      }

      if (result.status === 'busy') {
        await interaction.editReply('Sprawdzanie promocji juz trwa.');
        return;
      }

      await interaction.editReply(
        `Sprawdzono ${result.found} ofert. Nowe: ${result.fresh}. Wyslano: ${result.sent}.`
      );
      return;
    }

    if (sub === 'status') {
      const status = getGameDealsStatus();
      await interaction.editReply(
        [
          'Status promocji:',
          `wlaczone: ${status.settings.enabled ? 'tak' : 'nie'}`,
          `kanal: ${status.settings.channelId ? `<#${status.settings.channelId}>` : 'brak'}`,
          `min. przecena: ${status.settings.minDiscount}%`,
          `max cena CheapShark: ${status.settings.maxPrice} USD`,
          `limit: ${status.settings.maxPostsPerRun}`,
          `harmonogram: ${status.settings.cron} (${status.settings.timezone})`,
          `zapamietane gry: ${status.seenCount}`,
          `ostatnie sprawdzenie: ${status.lastCheckedAt || 'brak'}`
        ].join('\n')
      );
      return;
    }

    if (sub === 'reset') {
      resetSeenOffers();
      await interaction.editReply('Wyczyszczono pamiec wyslanych gier.');
    }
  }
};
