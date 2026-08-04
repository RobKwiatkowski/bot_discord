// Lokalny magazyn listy czlonkow klanu LEGION.
const fs = require('fs');
const { config } = require('../src/config');

const FILE = config.files.clanMembers || require('path').join(config.paths.dataDir, 'listaklanu.json');
const MANUAL_PREFIX = 'manual:';

function normalizeNick(nick) {
  return String(nick || '').trim().replace(/\s+/g, ' ');
}

function normalizedKey(value) {
  return normalizeNick(value).toLowerCase();
}

function manualId(nick) {
  return `${MANUAL_PREFIX}${normalizedKey(nick)}`;
}

function memberSource(member) {
  if (member.source) return member.source;
  return String(member.id || '').startsWith(MANUAL_PREFIX) ? 'manual' : 'discord';
}

function sameNick(member, nick) {
  const key = normalizedKey(nick);
  return normalizedKey(member.username) === key || normalizedKey(member.tag) === key;
}

function normalizeData(data) {
  const next = data && typeof data === 'object' ? data : {};
  next.roleId = next.roleId || null;
  next.members = Array.isArray(next.members) ? next.members : [];
  next.members.forEach(member => {
    member.source = memberSource(member);
  });
  return next;
}

function loadData() {
  if (!fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, JSON.stringify({ roleId: null, members: [] }, null, 2));
  }
  return normalizeData(JSON.parse(fs.readFileSync(FILE, 'utf8')));
}

function saveData(data) {
  fs.writeFileSync(FILE, JSON.stringify(normalizeData(data), null, 2));
}

function discordSnapshot(member, existing = {}) {
  return {
    ...existing,
    id: member.id,
    username: member.displayName,
    tag: member.user.username,
    avatarUrl: member.displayAvatarURL({ extension: 'png', size: 64 }),
    roleClan: existing.roleClan || 'Członek',
    source: 'discord',
    addedAt: existing.addedAt || new Date().toISOString()
  };
}

function upsertDiscordMember(member) {
  const data = loadData();
  const indexById = data.members.findIndex(item => item.id === member.id);
  const indexByManualNick = data.members.findIndex(item =>
    memberSource(item) === 'manual' && sameNick(item, member.displayName)
  );
  const index = indexById >= 0 ? indexById : indexByManualNick;
  const existing = index >= 0 ? data.members[index] : {};
  const next = discordSnapshot(member, existing);

  if (index >= 0) {
    data.members[index] = next;
  } else {
    data.members.push(next);
  }

  saveData(data);
  return next;
}

function addMember(member) {
  return upsertDiscordMember(member);
}

function removeMember(memberId) {
  const data = loadData();
  const before = data.members.length;
  data.members = data.members.filter(member =>
    !(member.id === memberId && memberSource(member) === 'discord')
  );

  if (data.members.length !== before) {
    saveData(data);
    return true;
  }

  return false;
}

function addManualMember(nick, roleClan = 'Członek') {
  const username = normalizeNick(nick);
  if (!username) {
    return { ok: false, reason: 'empty_nick' };
  }

  const data = loadData();
  const id = manualId(username);
  const index = data.members.findIndex(member => member.id === id || sameNick(member, username));
  const existing = index >= 0 ? data.members[index] : null;

  if (existing && memberSource(existing) === 'discord') {
    return { ok: false, reason: 'discord_member', member: existing };
  }

  const next = {
    ...(existing || {}),
    id,
    username,
    tag: username,
    avatarUrl: existing?.avatarUrl || null,
    roleClan,
    source: 'manual',
    addedAt: existing?.addedAt || new Date().toISOString()
  };

  if (index >= 0) {
    data.members[index] = next;
  } else {
    data.members.push(next);
  }

  saveData(data);
  return { ok: true, member: next, created: index < 0 };
}

function removeManualMember(nick) {
  const username = normalizeNick(nick);
  if (!username) {
    return { ok: false, reason: 'empty_nick' };
  }

  const data = loadData();
  const id = manualId(username);
  const index = data.members.findIndex(member => member.id === id || sameNick(member, username));

  if (index < 0) {
    return { ok: false, reason: 'not_found' };
  }

  const member = data.members[index];
  if (memberSource(member) === 'discord') {
    return { ok: false, reason: 'discord_member', member };
  }

  data.members.splice(index, 1);
  saveData(data);
  return { ok: true, member };
}

function getMembers() {
  return loadData().members;
}

module.exports = {
  addManualMember,
  addMember,
  getMembers,
  loadData,
  manualId,
  removeManualMember,
  removeMember,
  saveData,
  upsertDiscordMember
};
