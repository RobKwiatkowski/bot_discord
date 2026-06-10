// Aktualizuje lokalna liste klanu i WordPress, gdy zmieni sie rola klanowa.
const {
  addMember,
  removeMember,
  loadData,
  saveData
} = require('../klan/clanStore');

const { syncClanToWP } = require('../klan/wpSync');

const { config } = require('../src/config');
const CLAN_ROLE_ID = config.clan.roleId;

module.exports = {
  name: 'guildMemberUpdate',

  async execute(oldMember, newMember) {
    try {
      // 🔥 WYMUSZENIE ŚWIEŻYCH DANYCH
      await oldMember.fetch().catch(() => {});
      await newMember.fetch().catch(() => {});

      const hadRole = oldMember.roles.cache.has(CLAN_ROLE_ID);
      const hasRole = newMember.roles.cache.has(CLAN_ROLE_ID);

      let shouldSync = false;

      // ➕ NADANIE ROLI
      if (!hadRole && hasRole) {
        console.log('➕ Dodano do klanu:', newMember.user.tag);
        addMember(newMember);
        shouldSync = true;
      }

      // ➖ ODEBRANIE ROLI
      if (hadRole && !hasRole) {
        console.log('➖ Usunięto z klanu:', newMember.user.tag);
        removeMember(newMember.id);
        shouldSync = true;
      }

      // 🔄 ZMIANA NICKU
      if (hasRole) {
        const data = loadData();
        const member = data.members.find(m => m.id === newMember.id);
        const avatarUrl = newMember.displayAvatarURL({ extension: 'png', size: 64 });

        if (
          member &&
          (
            member.username !== newMember.displayName ||
            member.tag !== newMember.user.username ||
            member.avatarUrl !== avatarUrl
          )
        ) {
          member.username = newMember.displayName;
          member.tag = newMember.user.username;
          member.avatarUrl = avatarUrl;
          saveData(data);
          shouldSync = true;
        }
      }

      // 🌍 SYNC DO WP
      if (shouldSync) {
        await syncClanToWP();
        console.log('[WP] Sync OK');
      }

    } catch (err) {
      console.error('❌ guildMemberUpdate error:', err);
    }
  }
};
