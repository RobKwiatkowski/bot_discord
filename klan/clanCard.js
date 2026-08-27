// Renderuje liste klanu jako karte PNG w stylu pozostalych kart Sentinela.
const path = require('path');
const { createCanvas, loadImage } = require('canvas');
const { getMembers } = require('./clanStore');

const WIDTH = 1100;
const PADDING = 26;
const COLORS = {
  card: '#2f3238',
  border: '#3f434b',
  panel: '#3a3d44',
  panelAlt: '#34373e',
  badge: '#25282e',
  text: '#f2f3f5',
  muted: '#b7bbc4',
  muted2: '#8c929e',
  accent: '#c40000'
};

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, width, height, radius, color) {
  ctx.fillStyle = color;
  roundRect(ctx, x, y, width, height, radius);
  ctx.fill();
}

function truncateText(ctx, text, maxWidth) {
  const value = String(text || 'Nieznany');
  if (ctx.measureText(value).width <= maxWidth) return value;
  let shortened = value;
  while (shortened.length > 1 && ctx.measureText(`${shortened}...`).width > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened}...`;
}

function normalizeName(value) {
  return String(value || '').trim().toLocaleLowerCase('pl-PL');
}

function memberAvatarUrl(member, guild) {
  const cachedById = guild?.members?.cache?.get(String(member.id || ''));
  const wantedName = normalizeName(member.username || member.tag);
  const cachedByName = !cachedById && wantedName
    ? guild?.members?.cache?.find(item => [
        item.displayName,
        item.user?.username,
        item.user?.globalName
      ].some(name => normalizeName(name) === wantedName))
    : null;
  const discordMember = cachedById || cachedByName;

  if (discordMember) {
    return discordMember.displayAvatarURL({ extension: 'png', size: 128 });
  }
  return member.avatarUrl || null;
}

async function loadMemberAvatar(member, guild) {
  const avatarUrl = memberAvatarUrl(member, guild);
  if (!avatarUrl) return null;
  try {
    return await loadImage(avatarUrl);
  } catch {
    return null;
  }
}

function drawAvatar(ctx, image, member, x, y, size) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  if (image) {
    ctx.drawImage(image, x, y, size, size);
  } else {
    ctx.fillStyle = COLORS.badge;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(size * 0.48)}px Arial`;
    ctx.fillText(String(member?.username || '?').charAt(0).toUpperCase(), x + size / 2, y + size * 0.68);
  }
  ctx.restore();
  ctx.textAlign = 'left';
}

async function drawHeader(ctx) {
  const logoSize = 82;
  const logoPath = path.join(__dirname, '..', 'assets', 'clan_logo.png');

  fillRoundRect(ctx, PADDING, PADDING, logoSize, logoSize, 15, '#15171b');
  try {
    const logo = await loadImage(logoPath);
    ctx.save();
    roundRect(ctx, PADDING, PADDING, logoSize, logoSize, 15);
    ctx.clip();
    ctx.drawImage(logo, PADDING, PADDING, logoSize, logoSize);
    ctx.restore();
  } catch {
    ctx.fillStyle = COLORS.text;
    ctx.font = '700 22px Arial';
    ctx.fillText('LGN', PADDING + 18, PADDING + 50);
  }

  ctx.fillStyle = COLORS.text;
  ctx.font = '700 39px Arial';
  ctx.fillText('Polish PUBG Legion', PADDING + logoSize + 20, PADDING + 38);

  ctx.fillStyle = COLORS.muted;
  ctx.font = '700 23px Arial';
  ctx.fillText('Pełny skład klanu', PADDING + logoSize + 20, PADDING + 70);
}

async function drawRolePanel(ctx, x, y, width, title, members, accent) {
  const height = 96;
  fillRoundRect(ctx, x, y, width, height, 8, COLORS.panel);

  ctx.fillStyle = accent;
  ctx.font = '700 16px Arial';
  ctx.fillText(title, x + 14, y + 23);

  if (members.length === 0) {
    ctx.fillStyle = COLORS.muted;
    ctx.font = '700 21px Arial';
    ctx.fillText('—', x + 14, y + 64);
    return;
  }

  const visibleMembers = members.slice(0, 3);
  const cellWidth = width / visibleMembers.length;
  visibleMembers.forEach((member, index) => {
    const cellX = x + index * cellWidth;
    drawAvatar(ctx, member._avatar || null, member, cellX + 14, y + 38, 44);

    ctx.fillStyle = COLORS.text;
    ctx.font = '700 19px Arial';
    const suffix = index === visibleMembers.length - 1 && members.length > 3
      ? ` +${members.length - 3}`
      : '';
    ctx.fillText(
      truncateText(ctx, `${member.username}${suffix}`, cellWidth - 72),
      cellX + 68,
      y + 67
    );
  });
}

function drawMemberGrid(ctx, members, startY) {
  const columns = 3;
  const gap = 16;
  const rowGap = 9;
  const rowHeight = 54;
  const width = (WIDTH - PADDING * 2 - gap * (columns - 1)) / columns;

  ctx.fillStyle = COLORS.text;
  ctx.font = '700 25px Arial';
  ctx.fillText('Członkowie', PADDING, startY);

  const rowsStart = startY + 20;
  members.forEach((member, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = PADDING + column * (width + gap);
    const y = rowsStart + row * (rowHeight + rowGap);

    fillRoundRect(ctx, x, y, width, rowHeight, 7, row % 2 ? COLORS.panelAlt : COLORS.panel);
    drawAvatar(ctx, member._avatar || null, member, x + 8, y + 8, 38);

    ctx.fillStyle = COLORS.text;
    ctx.font = '700 20px Arial';
    ctx.fillText(truncateText(ctx, member.username, width - 72), x + 60, y + 34);
  });
}

async function createClanCard({ guild } = {}) {
  const members = getMembers();
  const founder = members.filter(member => member.roleClan === 'Założyciel');
  const managers = members.filter(member => member.roleClan === 'Kierownik');
  const regulars = members.filter(member => member.roleClan === 'Członek');
  const other = members.filter(member => !['Założyciel', 'Kierownik', 'Członek'].includes(member.roleClan));
  const listedMembers = [...regulars, ...other];
  const avatars = await Promise.all(members.map(member => loadMemberAvatar(member, guild)));
  const avatarByMember = new Map(members.map((member, index) => [member, avatars[index]]));
  members.forEach(member => {
    member._avatar = avatarByMember.get(member) || null;
  });
  const memberRows = Math.max(1, Math.ceil(listedMembers.length / 3));
  const memberStartY = 270;
  const height = Math.max(520, memberStartY + 20 + memberRows * 63 + 82);
  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext('2d');

  fillRoundRect(ctx, 0, 0, WIDTH, height, 28, COLORS.card);
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, WIDTH - 2, height - 2, 28);
  ctx.stroke();

  await drawHeader(ctx);

  const panelGap = 18;
  const panelWidth = (WIDTH - PADDING * 2 - panelGap) / 2;
  await drawRolePanel(ctx, PADDING, 142, panelWidth, 'Założyciel', founder, '#f2c94c');
  await drawRolePanel(ctx, PADDING + panelWidth + panelGap, 142, panelWidth, 'Kierownicy', managers, '#c6cbd3');
  drawMemberGrid(ctx, listedMembers, memberStartY);

  const footerY = height - 30;
  ctx.fillStyle = COLORS.muted;
  ctx.font = '700 16px Arial';
  ctx.fillText(`Łącznie: ${members.length} członków`, PADDING, footerY);

  const powered = 'Obsługiwane przez Sentinel';
  ctx.fillStyle = COLORS.muted2;
  ctx.fillText(powered, WIDTH - PADDING - ctx.measureText(powered).width, footerY);

  return canvas.toBuffer('image/png');
}

module.exports = { createClanCard };
