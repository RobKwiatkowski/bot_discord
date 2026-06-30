const { ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const {
  getAntiSpamStatus,
  resetAntiSpamSettings,
  updateAntiSpamSettings
} = require('../src/features/antiSpam');

const actionLabels = {
  timeout: 'przerwa czasowa',
  ban: 'ban',
  alert: 'tylko alert'
};

function formatSettings(settings) {
  const alertRoles = settings.alertRoleIds.length > 0
    ? settings.alertRoleIds.map(roleId => `<@&${roleId}>`).join(', ')
    : 'brak';

  return [
    'Aktualne ustawienia antyspamu:',
    `wlaczone: ${settings.enabled ? 'tak' : 'nie'}`,
    `tryb testowy: ${settings.dryRun ? 'tak' : 'nie'}`,
    `akcja: ${actionLabels[settings.action] || settings.action}`,
    `czas przerwy: ${settings.timeoutMinutes} min`,
    `kanal alertow: ${settings.alertChannelId ? `<#${settings.alertChannelId}>` : 'brak'}`,
    `pingowane role: ${alertRoles}`,
    `duplikaty: min. ${settings.duplicateMinLength} zn., ${settings.duplicateChannelLimit} kanaly / ${settings.duplicateWindowSeconds}s`,
    `szybki spam: ${settings.rateLimitCount} wiadomosci / ${settings.rateLimitSeconds}s`
  ].join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('antyspam')
    .setDescription('Konfiguracja reakcji systemu antyspamowego')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Pokazuje aktualne ustawienia antyspamu')
    )
    .addSubcommand(sub =>
      sub
        .setName('ustaw')
        .setDescription('Zmienia reakcje antyspamu')
        .addStringOption(option =>
          option
            .setName('akcja')
            .setDescription('Co bot ma zrobic po wykryciu spamu')
            .addChoices(
              { name: 'Przerwa czasowa', value: 'timeout' },
              { name: 'Ban', value: 'ban' },
              { name: 'Tylko alert', value: 'alert' }
            )
            .setRequired(false)
        )
        .addIntegerOption(option =>
          option
            .setName('czas_przerwy')
            .setDescription('Czas przerwy w minutach, gdy akcja to przerwa czasowa')
            .setMinValue(1)
            .setMaxValue(10080)
            .setRequired(false)
        )
        .addChannelOption(option =>
          option
            .setName('kanal_alertow')
            .setDescription('Kanal, na ktory trafiaja alerty antyspamowe')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
        .addBooleanOption(option =>
          option
            .setName('wlaczone')
            .setDescription('Wlacza albo wylacza antyspam')
            .setRequired(false)
        )
        .addBooleanOption(option =>
          option
            .setName('tryb_testowy')
            .setDescription('W trybie testowym bot tylko powiadamia, bez kasowania i kar')
            .setRequired(false)
        )
        .addIntegerOption(option =>
          option
            .setName('min_duplikatu')
            .setDescription('Minimalna dlugosc wiadomosci sprawdzanej jako duplikat')
            .setMinValue(1)
            .setMaxValue(200)
            .setRequired(false)
        )
        .addIntegerOption(option =>
          option
            .setName('kanaly_duplikatu')
            .setDescription('Na ilu kanalach ta sama tresc oznacza spam')
            .setMinValue(2)
            .setMaxValue(10)
            .setRequired(false)
        )
        .addIntegerOption(option =>
          option
            .setName('okno_duplikatu')
            .setDescription('Ile sekund bot pamieta duplikaty miedzy kanalami')
            .setMinValue(5)
            .setMaxValue(300)
            .setRequired(false)
        )
        .addIntegerOption(option =>
          option
            .setName('limit_wiadomosci')
            .setDescription('Ile wiadomosci w oknie czasu oznacza szybki spam')
            .setMinValue(2)
            .setMaxValue(50)
            .setRequired(false)
        )
        .addIntegerOption(option =>
          option
            .setName('okno_wiadomosci')
            .setDescription('Ile sekund obejmuje limit szybkich wiadomosci')
            .setMinValue(2)
            .setMaxValue(300)
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('reset')
        .setDescription('Przywraca ustawienia antyspamu z pliku ENV')
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const sub = interaction.options.getSubcommand();

    if (sub === 'status') {
      const status = getAntiSpamStatus();
      await interaction.editReply(formatSettings(status.settings));
      return;
    }

    if (sub === 'reset') {
      const settings = resetAntiSpamSettings();
      await interaction.editReply(`Przywrocono ustawienia z ENV.\n\n${formatSettings(settings)}`);
      return;
    }

    if (sub === 'ustaw') {
      const updates = {};
      const action = interaction.options.getString('akcja');
      const timeoutMinutes = interaction.options.getInteger('czas_przerwy');
      const alertChannel = interaction.options.getChannel('kanal_alertow');
      const enabled = interaction.options.getBoolean('wlaczone');
      const dryRun = interaction.options.getBoolean('tryb_testowy');
      const duplicateMinLength = interaction.options.getInteger('min_duplikatu');
      const duplicateChannelLimit = interaction.options.getInteger('kanaly_duplikatu');
      const duplicateWindowSeconds = interaction.options.getInteger('okno_duplikatu');
      const rateLimitCount = interaction.options.getInteger('limit_wiadomosci');
      const rateLimitSeconds = interaction.options.getInteger('okno_wiadomosci');

      if (action) updates.action = action;
      if (timeoutMinutes !== null) updates.timeoutMinutes = timeoutMinutes;
      if (alertChannel) updates.alertChannelId = alertChannel.id;
      if (enabled !== null) updates.enabled = enabled;
      if (dryRun !== null) updates.dryRun = dryRun;
      if (duplicateMinLength !== null) updates.duplicateMinLength = duplicateMinLength;
      if (duplicateChannelLimit !== null) updates.duplicateChannelLimit = duplicateChannelLimit;
      if (duplicateWindowSeconds !== null) updates.duplicateWindowSeconds = duplicateWindowSeconds;
      if (rateLimitCount !== null) updates.rateLimitCount = rateLimitCount;
      if (rateLimitSeconds !== null) updates.rateLimitSeconds = rateLimitSeconds;

      if (Object.keys(updates).length === 0) {
        await interaction.editReply('Podaj przynajmniej jedno ustawienie do zmiany.');
        return;
      }

      const settings = updateAntiSpamSettings(updates);
      await interaction.editReply(`Zapisano ustawienia.\n\n${formatSettings(settings)}`);
    }
  }
};
