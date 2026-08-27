// Zapamietuje wybrane role niezaleznie od czlonkostwa na serwerze i przywraca
// je po ponownym dolaczeniu uzytkownika.
const { PermissionFlagsBits } = require('discord.js');
const {
  getMemberRoleIds,
  getTrackedRoleStats,
  reconcileGuildState,
  removeTrackedRole,
  syncMemberFromDiscord,
  updateStoredMemberIdentity,
  updateTrackedRoleName
} = require('../persistentRoleStore');

function canAssignRole(guild, role) {
  const botMember = guild.members.me;
  return Boolean(
    botMember &&
    role &&
    role.id !== guild.id &&
    !role.managed &&
    botMember.permissions.has(PermissionFlagsBits.ManageRoles) &&
    botMember.roles.highest.comparePositionTo(role) > 0
  );
}

async function restoreMemberRoles(member, source) {
  updateStoredMemberIdentity(member);

  const storedRoleIds = getMemberRoleIds(member.guild.id, member.id);
  if (storedRoleIds.length === 0) {
    return { restored: [], unavailable: [] };
  }

  const rolesToRestore = [];
  const unavailable = [];

  for (const roleId of storedRoleIds) {
    if (member.roles.cache.has(roleId)) continue;

    const role = member.guild.roles.cache.get(roleId);
    if (!canAssignRole(member.guild, role)) {
      unavailable.push(roleId);
      continue;
    }

    rolesToRestore.push(role);
  }

  if (rolesToRestore.length === 0) {
    return { restored: [], unavailable };
  }

  try {
    await member.roles.add(
      rolesToRestore,
      `Przywrocenie stalej roli (${source})`
    );

    console.log(
      `[stale-role] Przywrocono ${rolesToRestore.map(role => role.name).join(', ')} ` +
      `uzytkownikowi ${member.user.tag}`
    );

    return {
      restored: rolesToRestore.map(role => role.id),
      unavailable
    };
  } catch (error) {
    console.error(
      `[stale-role] Nie udalo sie przywrocic rol uzytkownikowi ${member.user.tag}:`,
      error
    );
    return { restored: [], unavailable: [...unavailable, ...rolesToRestore.map(role => role.id)] };
  }
}

async function reconcileGuild(guild) {
  const trackedRoleCount = getTrackedRoleStats(guild.id).length;
  if (trackedRoleCount === 0) return;

  try {
    await guild.members.fetch();
  } catch (error) {
    console.error(`[stale-role] Nie udalo sie pobrac czlonkow serwera ${guild.name}:`, error);
  }

  const reconciliation = reconcileGuildState(guild);

  if (reconciliation.removedRoleIds.length > 0) {
    console.warn(
      `[stale-role] Usunieto z konfiguracji nieistniejace role: ` +
      reconciliation.removedRoleIds.join(', ')
    );
  }

  for (const { member } of reconciliation.assignments) {
    await restoreMemberRoles(member, 'start bota');
  }

  console.log(
    `[stale-role] Synchronizacja ${guild.name}: ` +
    `${reconciliation.importedMembers} nowych wpisow, ` +
    `${reconciliation.assignments.length} zapamietanych osob.`
  );
}

function setupPersistentRoles(client) {
  client.on('guildMemberUpdate', (oldMember, newMember) => {
    try {
      const changes = syncMemberFromDiscord(oldMember, newMember);

      if (changes.added.length > 0) {
        console.log(
          `[stale-role] Zapamietano role ${changes.added.join(', ')} dla ${newMember.user.tag}`
        );
      }

      if (changes.removed.length > 0) {
        console.log(
          `[stale-role] Zapomniano role ${changes.removed.join(', ')} dla ${newMember.user.tag}`
        );
      }
    } catch (error) {
      console.error('[stale-role] Blad obslugi zmiany rol:', error);
    }
  });

  client.on('guildMemberAdd', async member => {
    try {
      await restoreMemberRoles(member, 'ponowne dolaczenie');
    } catch (error) {
      console.error(`[stale-role] Blad przywracania rol dla ${member.user.tag}:`, error);
    }
  });

  client.on('roleDelete', role => {
    try {
      const result = removeTrackedRole(role.guild.id, role.id);
      if (result.removed) {
        console.log(`[stale-role] Usunieta rola ${role.name} zostala zapomniana.`);
      }
    } catch (error) {
      console.error(`[stale-role] Blad usuwania nieistniejacej roli ${role.id}:`, error);
    }
  });

  client.on('roleUpdate', (oldRole, newRole) => {
    try {
      if (oldRole.name !== newRole.name) {
        updateTrackedRoleName(newRole.guild.id, newRole);
      }
    } catch (error) {
      console.error(`[stale-role] Blad aktualizacji nazwy roli ${newRole.id}:`, error);
    }
  });

  client.once('clientReady', async () => {
    for (const guild of client.guilds.cache.values()) {
      try {
        await reconcileGuild(guild);
      } catch (error) {
        console.error(`[stale-role] Blad synchronizacji serwera ${guild.name}:`, error);
      }
    }
  });
}

module.exports = {
  canAssignRole,
  restoreMemberRoles,
  setupPersistentRoles
};
