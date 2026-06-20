// Slash command dla powiazania nicku PUBG i nadawania roli rangi.
const { SlashCommandBuilder } = require('discord.js');
const { config } = require('../src/config');
const { readJson, writeJson } = require('../src/jsonStore');
const { getPlayerByName } = require('../src/pubgApi');
const { ensureRole, fetchPubgRank } = require('../src/features/pubgRanks');

const rankRoles = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'MASTER', 'CRYSTAL', 'SURVIVOR'];

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
        const { tier, mode, matches } = await fetchPubgRank(nickname);
        const role = await ensureRole(interaction.guild, tier);

        for (const rankName of rankRoles) {
          const oldRole = interaction.member.roles.cache.find(item => item.name.toUpperCase() === rankName);
          if (oldRole && oldRole.id !== role.id) await interaction.member.roles.remove(oldRole);
        }

        await interaction.member.roles.add(role);
        await interaction.editReply(`Twoja ranga to **${tier}**. Tryb: **${mode}** (${matches} meczow).`);
      } catch (error) {
        await interaction.editReply(`Blad: ${error.message}`);
      }
    }
  }
};
