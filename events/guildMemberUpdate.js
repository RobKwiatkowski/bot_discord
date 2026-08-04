// Updates Discord role driven lists and WordPress after member role changes.
const {
  addMember: addClanMember,
  removeMember: removeClanMember,
  loadData: loadClanData,
  saveData: saveClanData
} = require('../klan/clanStore');

const { syncClanToWP } = require('../klan/wpSync');
const {
  getAdministrationRoleKeys,
  removeAdministrationMember,
  sameRoleKeys,
  upsertAdministrationMember
} = require('../administracja/adminStore');
const { syncAdministrationToWP } = require('../administracja/wpSync');

const { config } = require('../src/config');
const CLAN_ROLE_ID = config.clan.roleId;

module.exports = {
  name: 'guildMemberUpdate',

  async execute(oldMember, newMember) {
    try {
      await oldMember.fetch().catch(() => {});
      await newMember.fetch().catch(() => {});

      const hadClanRole = oldMember.roles.cache.has(CLAN_ROLE_ID);
      const hasClanRole = newMember.roles.cache.has(CLAN_ROLE_ID);

      let shouldSyncClan = false;
      let shouldSyncAdministration = false;

      if (!hadClanRole && hasClanRole) {
        console.log('[clan] Dodano do klanu:', newMember.user.tag);
        addClanMember(newMember);
        shouldSyncClan = true;
      }

      if (hadClanRole && !hasClanRole) {
        console.log('[clan] Usunieto z klanu:', newMember.user.tag);
        removeClanMember(newMember.id);
        shouldSyncClan = true;
      }

      if (hasClanRole) {
        const data = loadClanData();
        const member = data.members.find(item => item.id === newMember.id);
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
          member.source = 'discord';
          saveClanData(data);
          shouldSyncClan = true;
        }
      }

      const oldAdministrationRoles = getAdministrationRoleKeys(oldMember);
      const newAdministrationRoles = getAdministrationRoleKeys(newMember);
      const administrationRolesChanged = !sameRoleKeys(oldAdministrationRoles, newAdministrationRoles);

      if (newAdministrationRoles.length > 0) {
        const changed = upsertAdministrationMember(newMember);

        if (changed || administrationRolesChanged) {
          console.log('[administracja] Zaktualizowano:', newMember.user.tag, newAdministrationRoles.join(', '));
          shouldSyncAdministration = true;
        }
      } else if (oldAdministrationRoles.length > 0) {
        const changed = removeAdministrationMember(newMember.id);

        if (changed || administrationRolesChanged) {
          console.log('[administracja] Usunieto:', newMember.user.tag);
          shouldSyncAdministration = true;
        }
      }

      if (shouldSyncClan) {
        await syncClanToWP();
        console.log('[WP] Clan sync OK');
      }

      if (shouldSyncAdministration) {
        await syncAdministrationToWP();
        console.log('[WP] Administration sync OK');
      }
    } catch (err) {
      console.error('guildMemberUpdate error:', err);
    }
  }
};
