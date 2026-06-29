// Centralna konfiguracja bota. Ten plik zbiera ID kanalow/rol oraz sekrety z ENV,
// zeby logika funkcji nie trzymala hasel ani tokenow na sztywno w kodzie.
const path = require('path');
const envFilePath = process.env.ENV_FILE || '.env';
require('dotenv').config({ path: envFilePath });

const rootDir = path.resolve(__dirname, '..');
const dataDir = path.resolve(env('DATA_DIR', rootDir));
const logsDir = path.resolve(env('LOG_DIR', path.join(dataDir, 'logs')));

function env(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function envNumber(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(name, fallback = false) {
  const value = env(name);
  if (!value) return fallback;
  return ['1', 'true', 'tak', 'yes', 'on'].includes(value.toLowerCase());
}

function envList(name, fallback = []) {
  const value = env(name);
  if (!value) return fallback;
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function rootPath(...parts) {
  return path.join(rootDir, ...parts);
}

const config = {
  rootDir,
  paths: {
    logsDir,
    commandsDir: rootPath('commands'),
    eventsDir: rootPath('events'),
    dataDir
  },
  discord: {
    token: env('DISCORD_TOKEN'),
    clientId: env('DISCORD_CLIENT_ID'),
    guildId: env('DISCORD_GUILD_ID'),
    generalChannelName: env('GENERAL_CHANNEL_NAME', '👩🏻‍💻︱główny'),
    defaultRoleName: env('DEFAULT_ROLE_NAME', 'Zweryfikowany'),
    moderatorRoleId: env('MODERATOR_ROLE_ID', '1506307087259533393'),
    adminRoleIds: envList('ADMIN_ROLE_IDS', [
      '1506304554315157544'
    ]),
    botActivity: env('BOT_ACTIVITY', 'NPC z uprawnieniami admina'),
    enableGuildMembersIntent: !envBool('DISCORD_DISABLE_GUILD_MEMBERS_INTENT', false),
    enableMessageContentIntent: envBool('DISCORD_ENABLE_MESSAGE_CONTENT_INTENT', false)
  },
  files: {
    lottery: path.join(dataDir, 'loteria.json'),
    bindings: path.join(dataDir, 'bindings.json'),
    clanList: path.join(dataDir, 'klan.json'),
    clanMembers: path.join(dataDir, 'listaklanu.json'),
    statsCache: path.join(dataDir, 'stats_cache.json'),
    season: path.join(dataDir, 'season.json'),
    streamers: path.join(dataDir, 'streamers.json'),
    temporaryVoiceConfig: path.join(dataDir, 'temporary_voice_config.json'),
    tickets: path.join(dataDir, 'tickets.json'),
    youtube: path.join(dataDir, 'youtube.json'),
    music: path.join(dataDir, 'music.json'),
    gameDeals: path.join(dataDir, 'game_deals.json'),
    antiSpam: path.join(dataDir, 'anti_spam.json'),
    anniversaries: path.join(dataDir, 'rocznice.json'),
    clanStats: path.join(dataDir, 'clan_stats.json'),
    chickenDinners: path.join(dataDir, 'chicken_dinners.json'),
    tempRoles: path.join(dataDir, 'tempRoles.json'),
    administration: path.join(dataDir, 'administracja.json'),
    top25Background: rootPath('top25.png'),
    googleServiceAccount: env('GOOGLE_SERVICE_ACCOUNT_FILE', rootPath('google-service-account.json'))
  },
  pubg: {
    apiKey: env('PUBG_API_KEY'),
    platform: env('PUBG_PLATFORM', env('PLATFORM', 'steam')),
    region: env('PUBG_REGION', 'steam'),
    clanId: env('PUBG_CLAN_ID', 'clan.5c19a5d4e192425598641f055785cfb5'),
    rankedRequestDelayMs: envNumber('PUBG_REQUEST_DELAY_MS', 15000),
    statsCacheTtlMs: envNumber('PUBG_STATS_CACHE_TTL_MS', 60 * 60 * 1000),
    clanLevelCheckMs: envNumber('PUBG_CLAN_LEVEL_CHECK_MS', 60 * 1000),
    chickenChannelId: env('PUBG_CHICKEN_CHANNEL_ID', '1518343160382754816'),
    chickenChannelName: env('PUBG_CHICKEN_CHANNEL_NAME'),
    chickenCheckMs: envNumber('PUBG_CHICKEN_CHECK_MS', 2 * 60 * 1000),
    chickenRequestDelayMs: envNumber('PUBG_CHICKEN_REQUEST_DELAY_MS', 7000),
    chickenMaxRequestsPerRun: envNumber('PUBG_CHICKEN_MAX_REQUESTS_PER_RUN', 8),
    chickenMatchLookback: envNumber('PUBG_CHICKEN_MATCH_LOOKBACK', 5),
    chickenAnnounceOnFirstRun: envBool('PUBG_CHICKEN_ANNOUNCE_ON_FIRST_RUN', false)
  },
  voice: {
    standardCategoryId: env('VOICE_STANDARD_CATEGORY_ID', '1506389483812032704'),
    otherGamesCategoryId: env('VOICE_OTHER_GAMES_CATEGORY_ID', '1506389589437190364'),
    technicalChannelId: env('VOICE_TECHNICAL_CHANNEL_ID', '1506317778884493322'),
    logChannelId: env('VOICE_LOG_CHANNEL_ID', '1507281282990866453'),
    creatorNames: envList('VOICE_CREATOR_NAMES', [
      '➕ Normal DUO',
      '➕ Normal SQUAD',
      '➕ Ranked DUO',
      '➕ Ranked SQUAD',
      '➕ Inna Gra'
    ])
  },
  tickets: {
    categoryId: env('TICKET_CATEGORY_ID', '1506386954571219056'),
    archiveCategoryId: env('TICKET_ARCHIVE_CATEGORY_ID', '1506387177326776370')
  },
  reactionRoles: {
    channelId: env('REACTION_ROLES_CHANNEL_ID', '1506375175048925234')
  },
  notifications: {
    leaveLogChannelId: env('LEAVE_LOG_CHANNEL_ID', '1506378538113040414'),
    newAccountAlertChannelId: env('NEW_ACCOUNT_ALERT_CHANNEL_ID', '1506378538113040414'),
    newAccountAlertMaxAgeDays: envNumber('NEW_ACCOUNT_ALERT_MAX_AGE_DAYS', 30),
    boostSystemChannelId: env('BOOST_SYSTEM_CHANNEL_ID', '1506378538113040414'),
    thankChannelId: env('THANK_CHANNEL_ID', '1506376497416372465'),
    youtubeChannelId: env('YOUTUBE_NOTIFY_CHANNEL_ID', '1506365761570996365'),
    youtubeCheckMs: envNumber('YOUTUBE_CHECK_MS', 30 * 60 * 1000),
    twitchChannelName: env('TWITCH_NOTIFY_CHANNEL_NAME', '🔴︱streamy'),
    streamerRoleName: env('STREAMER_ROLE_NAME', 'Streamer'),
    twitchCheckMs: envNumber('TWITCH_CHECK_MS', 60 * 1000)
  },
  antiSpam: {
    enabled: envBool('ANTI_SPAM_ENABLED', true),
    dryRun: envBool('ANTI_SPAM_DRY_RUN', true),
    action: env('ANTI_SPAM_ACTION', 'timeout'),
    alertChannelId: env('ANTI_SPAM_ALERT_CHANNEL_ID', env('NEW_ACCOUNT_ALERT_CHANNEL_ID', '1506378538113040414')),
    alertRoleIds: envList('ANTI_SPAM_ALERT_ROLE_IDS', envList('ADMIN_ROLE_IDS', [
      '1506304554315157544'
    ])),
    trustedRoleIds: envList('ANTI_SPAM_TRUSTED_ROLE_IDS', [
      env('MODERATOR_ROLE_ID', '1506307087259533393'),
      ...envList('ADMIN_ROLE_IDS', [
        '1506304554315157544'
      ])
    ].filter(Boolean)),
    ignoredChannelIds: envList('ANTI_SPAM_IGNORED_CHANNEL_IDS'),
    ignoredCategoryIds: envList('ANTI_SPAM_IGNORED_CATEGORY_IDS'),
    timeoutMinutes: envNumber('ANTI_SPAM_TIMEOUT_MINUTES', 30),
    duplicateWindowSeconds: envNumber('ANTI_SPAM_DUPLICATE_WINDOW_SECONDS', 20),
    duplicateChannelLimit: envNumber('ANTI_SPAM_DUPLICATE_CHANNEL_LIMIT', 2),
    duplicateMinLength: envNumber('ANTI_SPAM_DUPLICATE_MIN_LENGTH', 8),
    duplicateSimilarity: envNumber('ANTI_SPAM_DUPLICATE_SIMILARITY', 0.92),
    rateLimitCount: envNumber('ANTI_SPAM_RATE_LIMIT_COUNT', 6),
    rateLimitSeconds: envNumber('ANTI_SPAM_RATE_LIMIT_SECONDS', 10),
    actionCooldownSeconds: envNumber('ANTI_SPAM_ACTION_COOLDOWN_SECONDS', 60),
    blockDiscordInvites: envBool('ANTI_SPAM_BLOCK_DISCORD_INVITES', true),
    blockSuspiciousLinks: envBool('ANTI_SPAM_BLOCK_SUSPICIOUS_LINKS', true)
  },
  gameDeals: {
    enabled: envBool('GAME_DEALS_ENABLED', true),
    channelId: env('GAME_DEALS_CHANNEL_ID'),
    cron: env('GAME_DEALS_CRON', '0 10 * * *'),
    timezone: env('GAME_DEALS_TIMEZONE', 'Europe/Warsaw'),
    runOnStart: envBool('GAME_DEALS_RUN_ON_START', true),
    minDiscount: envNumber('GAME_DEALS_MIN_DISCOUNT', 80),
    maxPrice: envNumber('GAME_DEALS_MAX_PRICE', 60),
    maxPostsPerRun: envNumber('GAME_DEALS_MAX_POSTS_PER_RUN', 10),
    maxSeenOffers: envNumber('GAME_DEALS_MAX_SEEN_OFFERS', 2000),
    locale: env('GAME_DEALS_LOCALE', 'pl-PL'),
    country: env('GAME_DEALS_COUNTRY', 'PL')
  },
  music: {
    textChannelId: env('MUSIC_TEXT_CHANNEL_ID'),
    voiceChannelId: env('MUSIC_VOICE_CHANNEL_ID'),
    maxQueueSize: envNumber('MUSIC_MAX_QUEUE_SIZE', 50),
    searchLimit: envNumber('MUSIC_SEARCH_LIMIT', 5),
    idleDisconnectMs: envNumber('MUSIC_IDLE_DISCONNECT_MS', 5 * 60 * 1000),
    voiceDebug: envBool('MUSIC_VOICE_DEBUG', false)
  },
  twitch: {
    clientId: env('TWITCH_CLIENT_ID'),
    clientSecret: env('TWITCH_CLIENT_SECRET'),
    accessToken: env('TWITCH_ACCESS_TOKEN')
  },
  google: {
    spreadsheetId: env('GOOGLE_SPREADSHEET_ID', '1jVPsfu08neQOcmK_A47Hp_BhbZubHs2XvsZc0BLaluY')
  },
  wordpress: {
    clanEndpoint: env('WP_CLAN_ENDPOINT', 'http://192.168.0.223/wp-json/legion/v1/klan'),
    administrationEndpoint: env('WP_ADMINISTRATION_ENDPOINT', 'http://192.168.0.223/wp-json/legion/v1/administracja'),
    clanPromotionEndpoint: env('WP_CLAN_PROMOTION_ENDPOINT', 'http://192.168.0.223/wp-json/legion/v1/klan-promotion'),
    tipEndpoint: env('WP_TIP_ENDPOINT', 'http://192.168.0.223/wp-json/nationaldevils/v1/tip'),
    pageUrl: env('WP_PAGE_URL', 'https://192.168.0.223/wp-json/wp/v2/pages/43'),
    user: env('WP_USER'),
    appPassword: env('WP_APP_PASSWORD'),
    eventsUrl: env('WP_EVENTS_URL'),
    eventsToken: env('WP_EVENTS_TOKEN')
  },
  tipply: {
    channelId: env('TIPPLY_CHANNEL_ID', '1506376497416372465'),
    widgetUrl: env('TIPPLY_WIDGET_URL'),
    browserExecutablePath: env('PUPPETEER_EXECUTABLE_PATH')
  },
  clan: {
    roleId: env('CLAN_ROLE_ID', '1506382288655745165'),
    statsChannelName: env('CLAN_STATS_CHANNEL_NAME', '👩🏻‍💻︱główny')
  },
  administration: {
    roles: [
      {
        key: 'administrator',
        label: env('ADMINISTRATION_ADMIN_LABEL', 'Administrator'),
        roleIds: envList('ADMINISTRATION_ADMIN_ROLE_IDS', envList('ADMIN_ROLE_IDS', [
          '1506304554315157544'
        ])),
        roleNames: envList('ADMINISTRATION_ADMIN_ROLE_NAMES', ['Administrator'])
      },
      {
        key: 'moderator',
        label: env('ADMINISTRATION_MODERATOR_LABEL', 'Moderator'),
        roleIds: envList('ADMINISTRATION_MODERATOR_ROLE_IDS', [
          env('MODERATOR_ROLE_ID', '1506307087259533393')
        ].filter(Boolean)),
        roleNames: envList('ADMINISTRATION_MODERATOR_ROLE_NAMES', ['Moderator'])
      },
      {
        key: 'bot',
        label: env('ADMINISTRATION_BOT_LABEL', 'Bot'),
        roleIds: envList('ADMINISTRATION_BOT_ROLE_IDS', [
          env('BOT_ROLE_ID')
        ].filter(Boolean)),
        roleNames: envList('ADMINISTRATION_BOT_ROLE_NAMES', ['Bot'])
      }
    ]
  },
  search: {
    allowedChannelId: env('SEARCH_ALLOWED_CHANNEL_ID', '1506365990298980392'),
    pingRoleId: env('SEARCH_PING_ROLE_ID', '1507294468246867988')
  },
  vipRoom: {
    categoryId: env('VIPROOM_CATEGORY_ID', '1506389483812032704'),
    allowedRoleIds: envList('VIPROOM_ALLOWED_ROLE_IDS', [
      '1507283147765579857',
      '1507283220448935996'
    ])
  }
};

function requireEnv(name, friendlyName = name) {
  if (!env(name)) {
    throw new Error(`Brakuje zmiennej srodowiskowej: ${friendlyName}`);
  }
}

module.exports = {
  config,
  env,
  envBool,
  envList,
  envNumber,
  requireEnv,
  rootPath
};
