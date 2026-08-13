// Komenda /statystyki korzysta z oficjalnego PUBG API i pokazuje rozbudowana
// karte statystyk SOLO/DUO/SQUAD z podzialem na TPP oraz FPP.
const { AttachmentBuilder, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { config } = require('../src/config');
const { getCurrentSeason, getPlayerByName, pubgRequest } = require('../src/pubgApi');
const {
  MODES,
  formatDecimal,
  formatInteger,
  formatPercent,
  formatSeasonLabel,
  platformLabel,
  renderPubgStatsCard,
  summarizeMode
} = require('../src/pubgStatsCard');

const MODE_LABELS = {
  solo: 'SOLO • TPP',
  duo: 'DUO • TPP',
  squad: 'SQUAD • TPP',
  'solo-fpp': 'SOLO • FPP',
  'duo-fpp': 'DUO • FPP',
  'squad-fpp': 'SQUAD • FPP'
};

function formatModeForEmbed(rawStats) {
  const stats = summarizeMode(rawStats);
  return [
    `Mecze: **${formatInteger(stats.matches)}**`,
    `Wygrane: **${formatInteger(stats.wins)}** (${formatPercent(stats.winRate)})`,
    `Top 10: **${formatInteger(stats.top10)}** (${formatPercent(stats.top10Rate)})`,
    `Kille: **${formatInteger(stats.kills)}**`,
    `K/D: **${formatDecimal(stats.kd)}**`,
    `KDA: **${formatDecimal(stats.kda)}**`,
    `Śr. DMG: **${formatInteger(stats.avgDamage)}**`,
    `Headshoty: **${formatPercent(stats.headshotRate)}**`
  ].join('\n');
}

function buildFallbackEmbed({ nickname, seasonId, range, gameModeStats }) {
  return new EmbedBuilder()
    .setTitle(`PUBG • ${nickname}`)
    .setColor(0xF2A900)
    .setDescription(`${platformLabel(config.pubg.platform)} • ${formatSeasonLabel(seasonId, range)}`)
    .addFields(...MODES.map(mode => ({
      name: MODE_LABELS[mode.key],
      value: formatModeForEmbed(gameModeStats[mode.key]),
      inline: true
    })))
    .setFooter({ text: 'National Devils • Oficjalne PUBG API' })
    .setTimestamp();
}

function errorMessage(error) {
  if (error?.status === 401 || error?.status === 403) {
    return 'PUBG API odrzuciło klucz dostępu. Administrator musi sprawdzić PUBG_API_KEY.';
  }
  if (error?.status === 429) {
    const wait = Number(error.retryAfter);
    return Number.isFinite(wait) && wait > 0
      ? `Limit zapytań PUBG API został wyczerpany. Spróbuj ponownie za ${Math.ceil(wait)} s.`
      : 'Limit zapytań PUBG API został wyczerpany. Spróbuj ponownie za chwilę.';
  }
  return 'Nie udało się pobrać statystyk z PUBG API. Spróbuj ponownie za chwilę.';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('statystyki')
    .setDescription('Statystyki gracza PUBG')
    .addStringOption(option =>
      option
        .setName('nick')
        .setDescription('Nick gracza PUBG')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('zakres')
        .setDescription('Aktualny sezon albo statystyki całej kariery')
        .setRequired(false)
        .addChoices(
          { name: 'Aktualny sezon', value: 'season' },
          { name: 'Cała kariera', value: 'lifetime' }
        )
    ),

  async execute(interaction) {
    const nick = interaction.options.getString('nick').trim();
    const range = interaction.options.getString('zakres') || 'season';
    await interaction.deferReply();

    try {
      const player = await getPlayerByName(nick);
      if (!player) {
        await interaction.editReply(`Nie znaleziono gracza **${nick}**.`);
        return;
      }

      const seasonId = range === 'lifetime' ? 'lifetime' : await getCurrentSeason();
      if (!seasonId) {
        await interaction.editReply('Nie znaleziono aktualnego sezonu PUBG.');
        return;
      }

      const statsData = await pubgRequest(
        `https://api.pubg.com/shards/${config.pubg.platform}/players/${player.id}/seasons/${seasonId}`
      );

      const gameModeStats = statsData?.data?.attributes?.gameModeStats || {};
      const nickname = player.attributes?.name || nick;

      try {
        const buffer = await renderPubgStatsCard({
          guild: interaction.guild,
          nickname,
          platform: config.pubg.platform,
          seasonId,
          range,
          gameModeStats
        });
        const attachment = new AttachmentBuilder(buffer, { name: 'pubg-statystyki.png' });
        await interaction.editReply({ files: [attachment] });
      } catch (renderError) {
        console.error('[statystyki] Błąd renderowania karty:', renderError);
        const embed = buildFallbackEmbed({ nickname, seasonId, range, gameModeStats });
        await interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      console.error('[statystyki] Błąd:', error);
      await interaction.editReply(errorMessage(error));
    }
  }
};
