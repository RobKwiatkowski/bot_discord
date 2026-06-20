// Ostrzezenie na kanale administracyjnym, gdy dolacza bardzo mlode konto.
const { EmbedBuilder } = require('discord.js');
const { config } = require('../config');
const { logToFile } = require('../logger');

const DAY_MS = 24 * 60 * 60 * 1000;

function formatDays(days) {
  if (days === 1) return 'dzien';
  return 'dni';
}

function setupNewAccountAlerts(client) {
  client.on('guildMemberAdd', async member => {
    const maxAgeDays = config.notifications.newAccountAlertMaxAgeDays;
    const maxAgeMs = maxAgeDays * DAY_MS;
    const accountAgeMs = Date.now() - member.user.createdTimestamp;

    if (accountAgeMs >= maxAgeMs) return;

    const accountAgeDays = Math.max(0, Math.floor(accountAgeMs / DAY_MS));
    const createdUnix = Math.floor(member.user.createdTimestamp / 1000);
    const avatarUrl = member.user.displayAvatarURL({ dynamic: true, size: 256 });
    const alertChannel = await member.guild.channels
      .fetch(config.notifications.newAccountAlertChannelId)
      .catch(() => null);

    if (!alertChannel || !alertChannel.isTextBased()) {
      logToFile(
        `[newAccountAlerts] Nie znaleziono kanalu alertow: ${config.notifications.newAccountAlertChannelId}`
      );
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xffa500)
      .setTitle('Uwaga: mlode konto dolaczylo do serwera')
      .setDescription(
        `Konto ${member} ma mniej niz ${maxAgeDays} dni. ` +
        'Zachowajcie ostroznosc przy kontakcie z ta osoba i obserwujcie jej aktywnosc.'
      )
      .setThumbnail(avatarUrl)
      .addFields(
        { name: 'Nick', value: `${member.user.tag}`, inline: true },
        { name: 'ID konta', value: member.id, inline: true },
        {
          name: 'Wiek konta',
          value: `${accountAgeDays} ${formatDays(accountAgeDays)}`,
          inline: true
        },
        {
          name: 'Konto utworzone',
          value: `<t:${createdUnix}:F>\n<t:${createdUnix}:R>`,
          inline: false
        }
      )
      .setFooter({ text: 'Automatyczny alert bezpieczenstwa' })
      .setTimestamp();

    try {
      await alertChannel.send({ embeds: [embed] });
    } catch (error) {
      logToFile(`[newAccountAlerts] Blad wysylki alertu dla ${member.user.tag}: ${error.message}`);
    }
  });
}

module.exports = { setupNewAccountAlerts };
