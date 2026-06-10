// Lokalny magazyn listy czlonkow klanu LEGION.
const fs = require('fs');
const { config } = require('../src/config');

const FILE = config.files.clanMembers || require('path').join(config.paths.dataDir, 'listaklanu.json');

function loadData() {
  if (!fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, JSON.stringify({ roleId: null, members: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(FILE));
}

function saveData(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function addMember(member) {
  const data = loadData();

  // ❌ nie dodawaj duplikatów
  if (data.members.some(m => m.id === member.id)) return;

  data.members.push({
    id: member.id,
    // ✅ nick z SERWERA
    username: member.displayName,
    // ✅ globalny username jako backup
    tag: member.user.username,
    avatarUrl: member.displayAvatarURL({ extension: 'png', size: 64 }),
    // ✅ DOMYŚLNA ROLA W KLANIE
    roleClan: 'Członek',
    addedAt: new Date().toISOString()
  });

  saveData(data);
}

function removeMember(memberId) {
  const data = loadData();
  data.members = data.members.filter(m => m.id !== memberId);
  saveData(data);
}

function getMembers() {
  return loadData().members;
}

module.exports = {
  addMember,
  removeMember,
  getMembers,
  loadData,
  saveData
};
