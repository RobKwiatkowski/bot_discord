// Local store for Discord administration roles shown on WordPress.
const fs = require('fs');
const { config } = require('../src/config');

const FILE = config.files.administration;

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function roleDefinitions() {
  return (config.administration.roles || [])
    .filter(role => role && role.key)
    .map(role => ({
      key: role.key,
      label: role.label || role.key,
      roleIds: Array.isArray(role.roleIds) ? role.roleIds.filter(Boolean).map(String) : [],
      roleNames: Array.isArray(role.roleNames) ? role.roleNames.filter(Boolean).map(normalizeText) : []
    }));
}

function publicRoleDefinitions() {
  return roleDefinitions().map(role => ({
    key: role.key,
    label: role.label
  }));
}

function defaultData() {
  return {
    roles: publicRoleDefinitions(),
    members: []
  };
}

function loadData() {
  if (!fs.existsSync(FILE)) {
    saveData(defaultData());
  }

  const data = JSON.parse(fs.readFileSync(FILE));
  return {
    roles: Array.isArray(data.roles) ? data.roles : publicRoleDefinitions(),
    members: Array.isArray(data.members) ? data.members : []
  };
}

function saveData(data) {
  const normalized = {
    roles: publicRoleDefinitions(),
    members: Array.isArray(data.members) ? data.members : []
  };

  fs.writeFileSync(FILE, JSON.stringify(normalized, null, 2));
}

function getAdministrationRoleKeys(member) {
  const memberRoleIds = new Set(member.roles.cache.map(role => String(role.id)));
  const memberRoleNames = new Set(member.roles.cache.map(role => normalizeText(role.name)));

  return roleDefinitions()
    .filter(role => (
      role.roleIds.some(roleId => memberRoleIds.has(roleId)) ||
      role.roleNames.some(roleName => memberRoleNames.has(roleName))
    ))
    .map(role => role.key);
}

function sameRoleKeys(a, b) {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

function snapshotMember(member, existing = {}) {
  const roleKeys = getAdministrationRoleKeys(member);
  const defsByKey = new Map(roleDefinitions().map(role => [role.key, role]));
  const roleLabels = roleKeys.map(key => defsByKey.get(key)?.label || key);

  return {
    id: member.id,
    username: member.displayName || member.user.username,
    tag: member.user.username,
    avatarUrl: member.displayAvatarURL({ extension: 'png', size: 64 }),
    roles: roleKeys,
    roleLabels,
    primaryRole: roleKeys[0] || '',
    primaryRoleLabel: roleLabels[0] || '',
    isBot: Boolean(member.user.bot),
    addedAt: existing.addedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function sameMemberRecord(a, b) {
  return (
    a.username === b.username &&
    a.tag === b.tag &&
    a.avatarUrl === b.avatarUrl &&
    a.primaryRole === b.primaryRole &&
    a.primaryRoleLabel === b.primaryRoleLabel &&
    a.isBot === b.isBot &&
    sameRoleKeys(a.roles || [], b.roles || []) &&
    sameRoleKeys(a.roleLabels || [], b.roleLabels || [])
  );
}

function sortMembers(members) {
  const order = new Map(roleDefinitions().map((role, index) => [role.key, index]));

  members.sort((a, b) => {
    const roleA = order.has(a.primaryRole) ? order.get(a.primaryRole) : Number.MAX_SAFE_INTEGER;
    const roleB = order.has(b.primaryRole) ? order.get(b.primaryRole) : Number.MAX_SAFE_INTEGER;

    if (roleA !== roleB) return roleA - roleB;
    return String(a.username || '').localeCompare(String(b.username || ''), 'pl');
  });
}

function upsertAdministrationMember(member) {
  const roleKeys = getAdministrationRoleKeys(member);

  if (roleKeys.length === 0) {
    return removeAdministrationMember(member.id);
  }

  const data = loadData();
  const index = data.members.findIndex(item => item.id === member.id);
  const existing = index >= 0 ? data.members[index] : {};
  const next = snapshotMember(member, existing);

  if (index >= 0 && sameMemberRecord(existing, next)) {
    return false;
  }

  if (index >= 0) {
    data.members[index] = next;
  } else {
    data.members.push(next);
  }

  sortMembers(data.members);
  saveData(data);
  return true;
}

function removeAdministrationMember(memberId) {
  const data = loadData();
  const nextMembers = data.members.filter(member => member.id !== memberId);

  if (nextMembers.length === data.members.length) {
    return false;
  }

  data.members = nextMembers;
  saveData(data);
  return true;
}

async function syncAdministrationFromGuild(guild) {
  await guild.members.fetch({ force: true });

  const current = loadData();
  const addedAtById = new Map(current.members.map(member => [member.id, member.addedAt]));
  const members = [];

  guild.members.cache.forEach(member => {
    if (getAdministrationRoleKeys(member).length === 0) return;

    members.push(snapshotMember(member, {
      addedAt: addedAtById.get(member.id)
    }));
  });

  sortMembers(members);
  saveData({ members });

  return {
    fetched: guild.members.cache.size,
    count: members.length
  };
}

module.exports = {
  getAdministrationRoleKeys,
  loadData,
  removeAdministrationMember,
  saveData,
  sameRoleKeys,
  syncAdministrationFromGuild,
  upsertAdministrationMember
};
