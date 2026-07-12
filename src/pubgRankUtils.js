const RANK_ROLES = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Crystal', 'Survivor'];

function normalizeRankName(baseRank) {
  const rank = RANK_ROLES.find(item => item.toUpperCase() === String(baseRank).toUpperCase());
  return rank || String(baseRank || '').trim();
}

function normalizeSubTier(subTier) {
  const raw = String(subTier || '').trim().toUpperCase();
  if (!raw) return '';

  const roman = {
    '1': 'I',
    '2': 'II',
    '3': 'III',
    '4': 'IV',
    I: 'I',
    II: 'II',
    III: 'III',
    IV: 'IV',
    V: 'V'
  };

  return roman[raw] || raw;
}

function rankSubTierNumber(subTier) {
  const normalized = normalizeSubTier(subTier);
  const roman = {
    I: '1',
    II: '2',
    III: '3',
    IV: '4',
    V: '5'
  };

  if (roman[normalized]) return roman[normalized];
  if (/^[1-9]$/.test(normalized)) return normalized;
  return '1';
}

function rankImageFileName(tier, subTier) {
  const normalizedTier = normalizeRankName(tier);
  if (!normalizedTier) return '';

  return `${normalizedTier}-${rankSubTierNumber(subTier)}.png`;
}

function getCurrentRankPoint(stats) {
  const value = stats?.currentRankPoint ?? stats?.rankPoints ?? stats?.rankPoint;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatRankLabel(rank) {
  return [rank?.tier, rank?.subTier].filter(Boolean).join(' ').trim();
}

function resolveRank(stats) {
  const apiTier = normalizeRankName(stats?.currentTier?.tier);
  const apiSubTier = normalizeSubTier(stats?.currentTier?.subTier);
  const rankPoint = getCurrentRankPoint(stats);
  const apiRank = apiTier
    ? {
        tier: apiTier,
        subTier: apiSubTier
      }
    : null;

  const rank = apiRank;

  return {
    tier: rank?.tier || 'Unranked',
    subTier: rank?.subTier || '',
    rankPoint,
    label: formatRankLabel(rank) || 'Unranked'
  };
}

function compareRankedModes(a, b) {
  if (!a) return -1;
  if (!b) return 1;

  const rankPointDiff = getCurrentRankPoint(a) - getCurrentRankPoint(b);
  if (rankPointDiff !== 0) return rankPointDiff;

  return (a.roundsPlayed || 0) - (b.roundsPlayed || 0);
}

module.exports = {
  RANK_ROLES,
  compareRankedModes,
  formatRankLabel,
  getCurrentRankPoint,
  normalizeRankName,
  normalizeSubTier,
  rankImageFileName,
  rankSubTierNumber,
  resolveRank
};
