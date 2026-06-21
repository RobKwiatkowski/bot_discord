// Slash command dla powiazania nicku PUBG i nadawania roli rangi.
const fs = require('fs');
const path = require('path');
const { AttachmentBuilder, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { config } = require('../src/config');
const { readJson, writeJson } = require('../src/jsonStore');
const { getPlayerByName } = require('../src/pubgApi');
const { ensureRole, fetchPubgRank } = require('../src/features/pubgRanks');
const { rankImageFileName } = require('../src/pubgRankUtils');

const rankRoles = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'MASTER', 'CRYSTAL', 'SURVIVOR'];
const rankColors = {
  BRONZE: 0xcd7f32,
  SILVER: 0xc0c0c0,
  GOLD: 0xf1c40f,
  PLATINUM: 0x78d5ef,
  DIAMOND: 0x58a6ff,
  MASTER: 0xb46cff,
  CRYSTAL: 0x62f0e8,
  SURVIVOR: 0xff6b35
};

function formatGameMode(mode) {
  const labels = {
    'solo-fpp': 'Solo FPP',
    'duo-fpp': 'Duo FPP',
    'squad-fpp': 'Squad FPP',
    solo: 'Solo TPP',
    duo: 'Duo TPP',
    squad: 'Squad TPP'
  };

  return labels[mode] || mode || 'Nieznany';
}

function findRankImage(tier, subTier) {
  const rankDir = path.join(config.rootDir, 'assets', 'Rangi');
  const candidates = [
    rankImageFileName(tier, subTier),
    rankImageFileName(tier, '1')
  ].filter(Boolean);

  for (const fileName of [...new Set(candidates)]) {
    const filePath = path.join(rankDir, fileName);
    if (fs.existsSync(filePath)) {
      return {
        fileName,
        filePath
      };
    }
  }

  return null;
}

function buildRankEmbed({ interaction, nickname, rankTier, rankLabel, rankPoints, apiRankLabel, mode, matches, rankImage }) {
  const displayLabel = rankLabel || rankTier || 'Unranked';
  const normalizedTier = String(rankTier || '').toUpperCase();
  const apiDiffers = apiRankLabel && apiRankLabel.toUpperCase() !== String(displayLabel).toUpperCase();
  const embed = new EmbedBuilder()
    .setColor(rankColors[normalizedTier] || 0x2b2d31)
    .setAuthor({
      name: nickname,
      iconURL: interaction.user.displayAvatarURL({ extension: 'png', size: 128 })
    })
    .setTitle('PUBG Ranked')
    .setDescription(`Twoja aktualna ranga to **${displayLabel}**.`)
    .addFields(
      { name: 'RP', value: rankPoints > 0 ? `**${rankPoints}**` : 'Brak danych', inline: true },
      { name: 'Tryb', value: `**${formatGameMode(mode)}**`, inline: true },
      { name: 'Mecze', value: `**${matches || 0}**`, inline: true }
    )
    .setFooter({ text: 'Sentinel | oficjalne PUBG API' })
    .setTimestamp();

  if (apiDiffers) {
    embed.addFields({
      name: 'Korekta po RP',
      value: `PUBG API zwrocilo **${apiRankLabel}**, ale **${rankPoints} RP** odpowiada randze **${displayLabel}**.`,
      inline: false
    });
  }

  if (rankImage) {
    embed.setThumbnail(`attachment://${rankImage.fileName}`);
  } else {
    embed.addFields({
      name: 'Obraz rangi',
      value: 'Nie znalazlem pliku grafiki rangi w `assets/Rangi`.',
      inline: false
    });
  }

  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pubg')
    .setDescription('Powiazanie konta PUBG i rola rangi')
    .addSubcommand(sub =>
      sub
        .setName('powiaz')
        .setDescription('Powiazuje Twoje konto Discord z nickiem PUBG')
        .addStringOption(option =>
          option
            .setName('nick')
            .setDescription('Nick PUBG')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('ranga')
        .setDescription('Pobiera Twoja range PUBG i nadaje role')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'powiaz') {
      await interaction.deferReply({ ephemeral: true });
      const nick = interaction.options.getString('nick');
      const player = await getPlayerByName(nick).catch(() => null);
      if (!player) {
        await interaction.editReply('Nie znaleziono gracza PUBG.');
        return;
      }

      const bindings = readJson(config.files.bindings, {});
      bindings[interaction.user.id] = player.attributes.name;
      writeJson(config.files.bindings, bindings);
      await interaction.editReply(`Powiazano z nickiem PUBG: **${player.attributes.name}**.`);
      return;
    }

    if (sub === 'ranga') {
      await interaction.deferReply();
      const bindings = readJson(config.files.bindings, {});
      const nickname = bindings[interaction.user.id];
      if (!nickname) {
        await interaction.editReply('Uzyj najpierw `/pubg powiaz nick:<nick>`.');
        return;
      }

      try {
        const { tier, rankTier, rankSubTier, rankLabel, rankPoints, apiRankLabel, mode, matches } = await fetchPubgRank(nickname);
        const role = await ensureRole(interaction.guild, tier);

        for (const rankName of rankRoles) {
          const oldRole = interaction.member.roles.cache.find(item => item.name.toUpperCase() === rankName);
          if (oldRole && oldRole.id !== role.id) await interaction.member.roles.remove(oldRole);
        }

        await interaction.member.roles.add(role);

        const rankImage = findRankImage(rankTier, rankSubTier);
        const embed = buildRankEmbed({
          interaction,
          nickname,
          rankTier,
          rankLabel,
          rankPoints,
          apiRankLabel,
          mode,
          matches,
          rankImage
        });
        const files = [];

        if (rankImage) {
          files.push(new AttachmentBuilder(rankImage.filePath, { name: rankImage.fileName }));
        }

        await interaction.editReply({ embeds: [embed], files });
      } catch (error) {
        await interaction.editReply(`Blad: ${error.message}`);
      }
    }
  }
};
