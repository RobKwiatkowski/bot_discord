const RANK_ROLES = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Crystal', 'Survivor'];

const POINT_RANKS = [
  { tier: 'Bronze', min: 1000, max: 1399, subTiers: true },
  { tier: 'Silver', min: 1400, max: 1799, subTiers: true },
  { tier: 'Gold', min: 1800, max: 2199, subTiers: true },
  { tier: 'Platinum', min: 2200, max: 2599, subTiers: true },
  { tier: 'Diamond', min: 2600, max: 2999, subTiers: true },
  { tier: 'Master', min: 3000, max: 3499, subTiers: false },
  { tier: 'Crystal', min: 3500, max: 3999, subTiers: true },
  { tier: 'Survivor', min: 4000, max: Number.POSITIVE_INFINITY, subTiers: false }
];

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

function rankFromPoints(rankPoint) {
  const points = Number(rankPoint);
  if (!Number.isFinite(points) || points <= 0) return null;

  const rank = POINT_RANKS.find(item => points >= item.min && points <= item.max) || POINT_RANKS[0];
  const subTierIndex = Math.min(3, Math.max(0, Math.floor((points - rank.min) / 100)));
  const subTier = rank.subTiers ? normalizeSubTier(4 - subTierIndex) : '';

  return {
    tier: rank.tier,
    subTier
  };
}

function formatRankLabel(rank) {
  return [rank?.tier, rank?.subTier].filter(Boolean).join(' ').trim();
}

function resolveRank(stats) {
  const apiTier = normalizeRankName(stats?.currentTier?.tier);
  const apiSubTier = normalizeSubTier(stats?.currentTier?.subTier);
  const rankPoint = getCurrentRankPoint(stats);
  const pointRank = rankFromPoints(rankPoint);
  const apiRank = apiTier
    ? {
        tier: apiTier,
        subTier: apiSubTier
      }
    : null;

  const rank = pointRank || apiRank;

  return {
    tier: rank?.tier || 'Unranked',
    subTier: rank?.subTier || '',
    rankPoint,
    apiTier: apiRank?.tier || '',
    apiSubTier: apiRank?.subTier || '',
    label: formatRankLabel(rank) || 'Unranked',
    apiLabel: formatRankLabel(apiRank)
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
  rankFromPoints,
  rankSubTierNumber,
  resolveRank
};
