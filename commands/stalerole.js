const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const {
  addTrackedRole,
  getTrackedRoleStats,
  removeTrackedRole
} = require('../src/persistentRoleStore');
const { canAssignRole } = require('../src/features/persistentRoles');
const { config } = require('../src/config');

function formatRoleList(guildId) {
  const roles = getTrackedRoleStats(guildId);
  if (roles.length === 0) {
    return 'Nie obserwuję obecnie żadnej roli.';
  }

  const lines = roles.map(role =>
    `• <@&${role.id}> — zapamiętanych osób: **${role.memberCount}**`
  );

  let message = `Obserwowane role (${roles.length}):\n`;
  let includedLines = 0;
  for (const line of lines) {
    if (`${message}${line}\n`.length > 1900) {
      message += `…i jeszcze ${lines.length - includedLines} ról.`;
      break;
    }
    message += `${line}\n`;
    includedLines += 1;
  }

  return message.trim();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stalerole')
    .setDescription('Zarządza rolami przywracanymi po ponownym wejściu na serwer')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(subcommand =>
      subcommand
        .setName('dodaj')
        .setDescription('Rozpoczyna obserwowanie roli')
        .addRoleOption(option =>
          option
            .setName('rola')
            .setDescription('Rola, którą bot ma zapamiętywać')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('usun')
        .setDescription('Kończy obserwowanie roli bez odbierania jej użytkownikom')
        .addRoleOption(option =>
          option
            .setName('rola')
            .setDescription('Rola, której bot ma już nie zapamiętywać')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('lista')
        .setDescription('Pokazuje wszystkie obserwowane role')
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: 'Tej komendy można używać tylko na serwerze.',
        ephemeral: true
      });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.reply({
        content: 'Potrzebujesz uprawnienia **Zarządzanie rolami**.',
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'lista') {
      await interaction.editReply(formatRoleList(interaction.guild.id));
      return;
    }

    const role = interaction.options.getRole('rola', true);

    if (subcommand === 'usun') {
      const result = removeTrackedRole(interaction.guild.id, role.id);

      if (!result.removed) {
        await interaction.editReply(`Rola ${role} nie była obserwowana.`);
        return;
      }

      await interaction.editReply(
        `Przestaję obserwować rolę ${role}. ` +
        `Usunięto **${result.forgottenMembers}** zapisanych przypisań. ` +
        'Rola nie została nikomu odebrana.'
      );
      return;
    }

    if (!config.discord.enableGuildMembersIntent) {
      await interaction.editReply(
        'Nie można rozpocząć obserwacji, ponieważ bot nie ma włączonego Guild Members Intent.'
      );
      return;
    }

    if (role.id === interaction.guild.id) {
      await interaction.editReply('Nie można obserwować roli **@everyone**.');
      return;
    }

    if (role.managed) {
      await interaction.editReply('Nie można obserwować roli zarządzanej przez bota lub integrację.');
      return;
    }

    if (!canAssignRole(interaction.guild, role)) {
      await interaction.editReply(
        `Nie mogę zarządzać rolą ${role}. Nadaj botowi uprawnienie **Zarządzanie rolami** ` +
        'i przenieś jego najwyższą rolę ponad obserwowaną rolę.'
      );
      return;
    }

    let fullMemberListFetched = true;
    try {
      await interaction.guild.members.fetch();
    } catch (error) {
      fullMemberListFetched = false;
      console.error('[stale-role] Nie udalo sie pobrac pelnej listy czlonkow:', error);
    }

    const result = addTrackedRole(
      interaction.guild,
      role,
      interaction.user.id
    );

    if (result.alreadyTracked) {
      await interaction.editReply(
        `Rola ${role} jest już obserwowana. ` +
        `Uzupełniono **${result.importedMembers}** brakujących przypisań.`
      );
      return;
    }

    const fetchWarning = fullMemberListFetched
      ? ''
      : '\n⚠️ Nie udało się pobrać pełnej listy członków; bot zapisał osoby obecne w pamięci podręcznej.';

    await interaction.editReply(
      `Rozpoczynam obserwowanie roli ${role}. ` +
      `Zapamiętano **${result.importedMembers}** obecnych posiadaczy.${fetchWarning}`
    );
  }
};
