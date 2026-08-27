// Trwaly zapis rol, ktore maja wrocic do uzytkownika po ponownym
// dolaczeniu do serwera. ID uzytkownika i roli sa zrodlem prawdy; nazwy sa
// zapisywane pomocniczo, zeby plik JSON byl czytelny dla administratora.
const path = require('path');
const { config } = require('./config');
const { readJson, writeJson } = require('./jsonStore');

const STORE_FILE = path.join(config.paths.dataDir, 'stale_role.json');

function emptyState() {
  return {
    version: 1,
    guilds: {}
  };
}

function loadState() {
  const state = readJson(STORE_FILE, emptyState());

  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return emptyState();
  }

  if (!state.guilds || typeof state.guilds !== 'object' || Array.isArray(state.guilds)) {
    state.guilds = {};
  }

  state.version = 1;
  return state;
}

function saveState(state) {
  writeJson(STORE_FILE, state);
}

function getGuildState(state, guildId, create = false) {
  let guildState = state.guilds[guildId];

  if (!guildState && create) {
    guildState = {
      trackedRoles: {},
      members: {}
    };
    state.guilds[guildId] = guildState;
  }

  if (!guildState) return null;

  if (
    !guildState.trackedRoles ||
    typeof guildState.trackedRoles !== 'object' ||
    Array.isArray(guildState.trackedRoles)
  ) {
    guildState.trackedRoles = {};
  }

  if (
    !guildState.members ||
    typeof guildState.members !== 'object' ||
    Array.isArray(guildState.members)
  ) {
    guildState.members = {};
  }

  return guildState;
}

function memberIdentity(member) {
  return {
    username: member.user?.username || member.id,
    displayName: member.displayName || member.user?.username || member.id
  };
}

function ensureMemberRole(guildState, member, role, recordedAt = new Date().toISOString()) {
  const identity = memberIdentity(member);
  let storedMember = guildState.members[member.id];

  if (!storedMember || typeof storedMember !== 'object' || Array.isArray(storedMember)) {
    storedMember = {
      ...identity,
      roles: {},
      updatedAt: recordedAt
    };
    guildState.members[member.id] = storedMember;
  }

  if (!storedMember.roles || typeof storedMember.roles !== 'object' || Array.isArray(storedMember.roles)) {
    storedMember.roles = {};
  }

  const isNewAssignment = !storedMember.roles[role.id];
  storedMember.username = identity.username;
  storedMember.displayName = identity.displayName;
  storedMember.updatedAt = recordedAt;
  storedMember.roles[role.id] = {
    name: role.name,
    recordedAt: storedMember.roles[role.id]?.recordedAt || recordedAt
  };

  return isNewAssignment;
}

function removeMemberRole(guildState, userId, roleId) {
  const storedMember = guildState.members[userId];
  if (!storedMember?.roles?.[roleId]) return false;

  delete storedMember.roles[roleId];

  if (Object.keys(storedMember.roles).length === 0) {
    delete guildState.members[userId];
  } else {
    storedMember.updatedAt = new Date().toISOString();
  }

  return true;
}

function addTrackedRole(guild, role, addedBy) {
  const state = loadState();
  const guildState = getGuildState(state, guild.id, true);
  const now = new Date().toISOString();
  const alreadyTracked = Boolean(guildState.trackedRoles[role.id]);

  guildState.trackedRoles[role.id] = {
    name: role.name,
    addedAt: guildState.trackedRoles[role.id]?.addedAt || now,
    addedBy: guildState.trackedRoles[role.id]?.addedBy || addedBy
  };

  let importedMembers = 0;
  for (const member of role.members.values()) {
    if (ensureMemberRole(guildState, member, role, now)) {
      importedMembers += 1;
    }
  }

  saveState(state);
  return { alreadyTracked, importedMembers };
}

function removeTrackedRole(guildId, roleId) {
  const state = loadState();
  const guildState = getGuildState(state, guildId);
  if (!guildState?.trackedRoles[roleId]) {
    return { removed: false, forgottenMembers: 0 };
  }

  delete guildState.trackedRoles[roleId];

  let forgottenMembers = 0;
  for (const userId of Object.keys(guildState.members)) {
    if (removeMemberRole(guildState, userId, roleId)) {
      forgottenMembers += 1;
    }
  }

  saveState(state);
  return { removed: true, forgottenMembers };
}

function updateTrackedRoleName(guildId, role) {
  const state = loadState();
  const guildState = getGuildState(state, guildId);
  if (!guildState?.trackedRoles[role.id]) return false;

  guildState.trackedRoles[role.id].name = role.name;
  for (const storedMember of Object.values(guildState.members)) {
    if (storedMember?.roles?.[role.id]) {
      storedMember.roles[role.id].name = role.name;
    }
  }

  saveState(state);
  return true;
}

function syncMemberFromDiscord(oldMember, newMember) {
  const state = loadState();
  const guildState = getGuildState(state, newMember.guild.id);
  if (!guildState || Object.keys(guildState.trackedRoles).length === 0) {
    return { added: [], removed: [] };
  }

  const added = [];
  const removed = [];
  const now = new Date().toISOString();

  for (const roleId of Object.keys(guildState.trackedRoles)) {
    const hadRole = oldMember.roles.cache.has(roleId);
    const hasRole = newMember.roles.cache.has(roleId);

    if (!hadRole && hasRole) added.push(roleId);
    if (hadRole && !hasRole) removed.push(roleId);

    if (hasRole) {
      const role = newMember.guild.roles.cache.get(roleId) || {
        id: roleId,
        name: guildState.trackedRoles[roleId].name
      };
      ensureMemberRole(guildState, newMember, role, now);
    } else if (hadRole) {
      removeMemberRole(guildState, newMember.id, roleId);
    }
  }

  // Przy ponownym dolaczeniu uzytkownik przez chwile nie ma jeszcze zadnej
  // przywracanej roli. Inna aktualizacja czlonka (np. autorola albo nick) nie
  // moze wtedy skasowac zapamietanych przypisan.
  const storedMember = guildState.members[newMember.id];
  if (storedMember) {
    const identity = memberIdentity(newMember);
    storedMember.username = identity.username;
    storedMember.displayName = identity.displayName;
    storedMember.updatedAt = now;
  }

  saveState(state);
  return { added, removed };
}

function updateStoredMemberIdentity(member) {
  const state = loadState();
  const guildState = getGuildState(state, member.guild.id);
  const storedMember = guildState?.members?.[member.id];
  if (!storedMember) return false;

  const identity = memberIdentity(member);
  storedMember.username = identity.username;
  storedMember.displayName = identity.displayName;
  storedMember.updatedAt = new Date().toISOString();
  saveState(state);
  return true;
}

function getMemberRoleIds(guildId, userId) {
  const state = loadState();
  const guildState = getGuildState(state, guildId);
  const roles = guildState?.members?.[userId]?.roles;
  return roles && typeof roles === 'object' ? Object.keys(roles) : [];
}

function getTrackedRoleStats(guildId) {
  const state = loadState();
  const guildState = getGuildState(state, guildId);
  if (!guildState) return [];

  return Object.entries(guildState.trackedRoles).map(([roleId, role]) => ({
    id: roleId,
    name: role.name,
    addedAt: role.addedAt,
    addedBy: role.addedBy,
    memberCount: Object.values(guildState.members).filter(member => member?.roles?.[roleId]).length
  }));
}

function reconcileGuildState(guild) {
  const state = loadState();
  const guildState = getGuildState(state, guild.id);
  if (!guildState || Object.keys(guildState.trackedRoles).length === 0) {
    return { assignments: [], importedMembers: 0, removedRoleIds: [] };
  }

  const removedRoleIds = [];
  let importedMembers = 0;
  const now = new Date().toISOString();

  for (const roleId of Object.keys(guildState.trackedRoles)) {
    const role = guild.roles.cache.get(roleId);

    if (!role) {
      removeTrackedRoleFromGuildState(guildState, roleId);
      removedRoleIds.push(roleId);
      continue;
    }

    guildState.trackedRoles[roleId].name = role.name;
    for (const member of role.members.values()) {
      if (ensureMemberRole(guildState, member, role, now)) {
        importedMembers += 1;
      }
    }
  }

  const assignments = [];
  for (const [userId, storedMember] of Object.entries(guildState.members)) {
    const member = guild.members.cache.get(userId);
    if (!member) continue;

    const identity = memberIdentity(member);
    storedMember.username = identity.username;
    storedMember.displayName = identity.displayName;
    storedMember.updatedAt = now;

    assignments.push({
      member,
      roleIds: Object.keys(storedMember.roles || {})
        .filter(roleId => guildState.trackedRoles[roleId])
    });
  }

  saveState(state);
  return { assignments, importedMembers, removedRoleIds };
}

function removeTrackedRoleFromGuildState(guildState, roleId) {
  delete guildState.trackedRoles[roleId];
  for (const userId of Object.keys(guildState.members)) {
    removeMemberRole(guildState, userId, roleId);
  }
}

module.exports = {
  STORE_FILE,
  addTrackedRole,
  getMemberRoleIds,
  getTrackedRoleStats,
  reconcileGuildState,
  removeTrackedRole,
  syncMemberFromDiscord,
  updateStoredMemberIdentity,
  updateTrackedRoleName
};
