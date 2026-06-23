const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { spawn } = require('child_process');
const {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel
} = require('@discordjs/voice');
const { constants: ytdlpConstants } = require('youtube-dl-exec');
const spotifyUrlInfo = require('spotify-url-info');
const { config } = require('../config');
const { readJson, writeJson } = require('../jsonStore');

const spotify = spotifyUrlInfo(globalThis.fetch);

const BUTTONS = {
  search: 'music_search',
  pause: 'music_pause',
  resume: 'music_resume',
  next: 'music_next',
  stop: 'music_stop',
  queue: 'music_queue',
  leave: 'music_leave'
};
const SEARCH_MODAL_ID = 'music_search_modal';
const SEARCH_INPUT_ID = 'music_query';
const SEARCH_SELECT_PREFIX = 'music_search_select:';
const EPHEMERAL_FLAGS = 64;
const SPOTIFY_TRACK_LIMIT = 25;
const YTDLP_HEADERS = [
  'referer:youtube.com',
  'user-agent:Mozilla/5.0'
];
const YTDLP_AUDIO_FORMAT = 'bestaudio[ext=webm][acodec=opus]/bestaudio/best';
const VOICE_READY_TIMEOUT_MS = 20 * 1000;
const VOICE_CONNECT_ATTEMPTS = 2;

const guildPlayers = new Map();

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clipText(text, maxLength) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 3)}...`;
}

function readState() {
  const state = readJson(config.files.music, {
    settings: {},
    panels: {}
  });

  return {
    settings: state.settings && typeof state.settings === 'object' ? state.settings : {},
    panels: state.panels && typeof state.panels === 'object' ? state.panels : {}
  };
}

function writeState(state) {
  writeJson(config.files.music, state);
}

function getSettings(state = readState()) {
  return {
    textChannelId: state.settings.textChannelId || config.music.textChannelId,
    voiceChannelId: state.settings.voiceChannelId || config.music.voiceChannelId,
    maxQueueSize: clampNumber(
      state.settings.maxQueueSize,
      1,
      200,
      config.music.maxQueueSize
    ),
    searchLimit: clampNumber(
      state.settings.searchLimit,
      1,
      10,
      config.music.searchLimit
    ),
    idleDisconnectMs: clampNumber(
      state.settings.idleDisconnectMs,
      30 * 1000,
      60 * 60 * 1000,
      config.music.idleDisconnectMs
    )
  };
}

function updateMusicSettings(updates) {
  const state = readState();
  state.settings = {
    ...state.settings,
    ...updates
  };
  writeState(state);
  return getSettings(state);
}

function rememberPanel(guildId, channelId, messageId) {
  const state = readState();
  state.panels[guildId] = { channelId, messageId };
  writeState(state);
}

function getPanelRef(guildId) {
  return readState().panels[guildId] || null;
}

function isSpotifyUrl(input) {
  return /(^spotify:|open\.spotify\.com|play\.spotify\.com)/i.test(input);
}

function isYouTubePlaylistUrl(input) {
  return /(?:youtube\.com|youtu\.be).*?[?&]list=/i.test(input);
}

function isUrl(input) {
  try {
    const parsed = new URL(input);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function getYtDlpPath() {
  return ytdlpConstants?.YOUTUBE_DL_PATH || 'yt-dlp';
}

function getYtDlpHeaderArgs() {
  return YTDLP_HEADERS.flatMap(header => ['--add-header', header]);
}

function runYtDlpJson(target, options = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '--dump-single-json',
      '--skip-download',
      '--no-warnings',
      ...getYtDlpHeaderArgs(),
      target
    ];

    if (options.noPlaylist !== false) {
      args.splice(2, 0, '--no-playlist');
    }

    if (options.flatPlaylist) {
      args.splice(2, 0, '--flat-playlist');
    }

    const subprocess = spawn(getYtDlpPath(), args, {
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';

    subprocess.stdout.on('data', chunk => {
      stdout += String(chunk);
    });

    subprocess.stderr.on('data', chunk => {
      stderr += String(chunk);
    });

    subprocess.on('error', reject);
    subprocess.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `yt-dlp zakonczyl sie kodem ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Nie udalo sie odczytac odpowiedzi yt-dlp: ${error.message}`));
      }
    });
  });
}

function spawnYtDlpAudio(url) {
  return spawn(getYtDlpPath(), [
    '--output',
    '-',
    '--format',
    YTDLP_AUDIO_FORMAT,
    '--no-playlist',
    '--no-warnings',
    '--quiet',
    ...getYtDlpHeaderArgs(),
    url
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
}

function formatDuration(seconds) {
  const parsed = Number(seconds);
  if (!Number.isFinite(parsed) || parsed <= 0) return 'na zywo / brak czasu';

  const hours = Math.floor(parsed / 3600);
  const minutes = Math.floor((parsed % 3600) / 60);
  const secs = Math.floor(parsed % 60);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function getErrorMessage(error) {
  return error?.message || String(error);
}

function parseDurationFormatted(value) {
  if (!value || typeof value !== 'string') return null;
  const parts = value.split(':').map(part => Number(part));
  if (parts.some(part => !Number.isFinite(part))) return null;

  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function getBestThumbnail(thumbnails) {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null;
  const sorted = [...thumbnails].sort((a, b) => {
    const aSize = Number(a.width || 0) * Number(a.height || 0);
    const bSize = Number(b.width || 0) * Number(b.height || 0);
    return bSize - aSize;
  });
  return sorted[0]?.url || null;
}

function normalizeYtDlpEntry(entry, requestedBy, source = 'youtube') {
  if (!entry?.title) return null;
  const url = entry.webpage_url || entry.url || entry.original_url;
  if (!url) return null;

  return {
    title: entry.title,
    url,
    durationSeconds: Number(entry.duration) || parseDurationFormatted(entry.duration_string),
    durationText: entry.duration_string || formatDuration(Number(entry.duration)),
    thumbnail: entry.thumbnail || getBestThumbnail(entry.thumbnails),
    channelName: entry.uploader || entry.channel || entry.extractor_key || 'YouTube',
    requestedBy: requestedBy?.id || null,
    requestedByTag: requestedBy?.tag || requestedBy?.username || null,
    source,
    originalQuery: null
  };
}

async function buildTrackFromMediaUrl(url, requestedBy, source = 'url') {
  const details = await runYtDlpJson(url);

  return {
    title: details.title || url,
    url: details.webpage_url || details.original_url || url,
    durationSeconds: Number(details.duration) || null,
    durationText: formatDuration(Number(details.duration)),
    thumbnail: details.thumbnail || getBestThumbnail(details.thumbnails),
    channelName: details.uploader || details.channel || details.extractor_key || 'Media',
    requestedBy: requestedBy?.id || null,
    requestedByTag: requestedBy?.tag || requestedBy?.username || null,
    source,
    originalQuery: null
  };
}

async function searchYouTube(query, limit = getSettings().searchLimit) {
  const searchTarget = `ytsearch${limit}:${query}`;
  const result = await runYtDlpJson(searchTarget, {
    noPlaylist: false
  });
  const entries = Array.isArray(result.entries) ? result.entries : [];

  return entries
    .map(entry => normalizeYtDlpEntry(entry, null))
    .filter(Boolean);
}

async function searchOneTrack(query, requestedBy, source = 'search') {
  const results = await searchYouTube(query, 1);
  const track = results[0] ? { ...results[0], requestedBy: requestedBy?.id || null, requestedByTag: requestedBy?.tag || requestedBy?.username || null, source } : null;
  if (!track) throw new Error(`Nie znaleziono utworu: ${query}`);
  track.originalQuery = query;
  return track;
}

function spotifyTrackToQuery(item) {
  if (!item) return null;

  if (typeof item.track === 'string') {
    return [item.artist, item.track].filter(Boolean).join(' ');
  }

  const track = item.track && typeof item.track === 'object' ? item.track : item;
  const title = track.name || track.title || item.title || item.track;
  const artists = Array.isArray(track.artists)
    ? track.artists.map(artist => artist.name).filter(Boolean).join(' ')
    : item.artist || track.artist || item.subtitle;

  const query = [artists, title].filter(Boolean).join(' ');
  return query || null;
}

async function resolveSpotifyTracks(input, requestedBy, remainingSlots) {
  if (/\/track\//i.test(input) || /^spotify:track:/i.test(input)) {
    const preview = await spotify.getPreview(input, {
      headers: { 'user-agent': 'googlebot' }
    });
    const query = spotifyTrackToQuery(preview);
    if (!query) throw new Error('Nie udalo sie odczytac metadanych Spotify.');
    return [await searchOneTrack(query, requestedBy, 'spotify')];
  }

  const tracks = await spotify.getTracks(input, {
    headers: { 'user-agent': 'googlebot' }
  });
  const limit = Math.min(remainingSlots, SPOTIFY_TRACK_LIMIT);
  const queries = (Array.isArray(tracks) ? tracks : [])
    .map(spotifyTrackToQuery)
    .filter(Boolean)
    .slice(0, limit);

  if (queries.length === 0) {
    const preview = await spotify.getPreview(input, {
      headers: { 'user-agent': 'googlebot' }
    });
    const query = spotifyTrackToQuery(preview);
    if (!query) throw new Error('Nie udalo sie odczytac metadanych Spotify.');
    queries.push(query);
  }

  const resolved = [];
  for (const query of queries) {
    try {
      resolved.push(await searchOneTrack(query, requestedBy, 'spotify'));
    } catch (error) {
      console.warn(`[music] Pomijam Spotify track "${query}": ${error.message}`);
    }
  }

  if (resolved.length === 0) {
    throw new Error('Nie udalo sie dopasowac utworow Spotify do YouTube.');
  }

  return resolved;
}

async function resolveYouTubePlaylist(input, requestedBy, remainingSlots) {
  const playlist = await runYtDlpJson(input, {
    flatPlaylist: true,
    noPlaylist: false
  });
  const list = Array.isArray(playlist.entries) ? playlist.entries : [];

  const tracks = list
    .slice(0, remainingSlots)
    .map(entry => normalizeYtDlpEntry(entry, requestedBy, 'youtube_playlist'))
    .filter(Boolean);

  if (tracks.length === 0) {
    throw new Error('Playlista YouTube nie zawiera odczytywalnych filmow.');
  }

  return tracks;
}

async function resolveInputToTracks(input, requestedBy, remainingSlots) {
  const trimmed = String(input || '').trim();
  if (!trimmed) throw new Error('Podaj link albo nazwe utworu.');
  if (remainingSlots <= 0) throw new Error('Kolejka jest pelna.');

  if (isSpotifyUrl(trimmed)) {
    return resolveSpotifyTracks(trimmed, requestedBy, remainingSlots);
  }

  if (isYouTubePlaylistUrl(trimmed)) {
    return resolveYouTubePlaylist(trimmed, requestedBy, remainingSlots);
  }

  if (isUrl(trimmed)) {
    return [await buildTrackFromMediaUrl(trimmed, requestedBy)];
  }

  return [await searchOneTrack(trimmed, requestedBy)];
}

function getStatusLabel(status) {
  switch (status) {
    case AudioPlayerStatus.Playing:
      return 'Odtwarzanie';
    case AudioPlayerStatus.Paused:
      return 'Pauza';
    case AudioPlayerStatus.Buffering:
      return 'Buforowanie';
    case AudioPlayerStatus.AutoPaused:
      return 'Auto-pauza';
    default:
      return 'Bezczynny';
  }
}

class GuildMusicPlayer {
  constructor(client, guildId) {
    this.client = client;
    this.guildId = guildId;
    this.queue = [];
    this.current = null;
    this.currentProcess = null;
    this.connection = null;
    this.voiceChannelId = null;
    this.textChannelId = null;
    this.idleTimer = null;
    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play
      }
    });

    this.player.on(AudioPlayerStatus.Idle, () => {
      if (this.current) {
        this.current = null;
        this.playNext().catch(error => {
          console.error('[music] Blad przy kolejnym utworze:', error);
          this.scheduleIdleDisconnect();
        });
      }
    });

    this.player.on('error', error => {
      console.error('[music] Blad odtwarzacza:', error.message);
      this.current = null;
      this.playNext().catch(nextError => {
        console.error('[music] Blad po awarii odtwarzacza:', nextError);
        this.scheduleIdleDisconnect();
      });
    });
  }

  get settings() {
    return getSettings();
  }

  get isPlaying() {
    return this.player.state.status === AudioPlayerStatus.Playing;
  }

  get isPaused() {
    return this.player.state.status === AudioPlayerStatus.Paused;
  }

  clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  killCurrentProcess() {
    const subprocess = this.currentProcess;
    this.currentProcess = null;
    if (!subprocess) return;

    try {
      if (typeof subprocess.kill === 'function' && !subprocess.killed) {
        subprocess.kill('SIGKILL');
      } else if (typeof subprocess.cancel === 'function') {
        subprocess.cancel();
      }
    } catch {
      // The process may already be gone after a natural track ending.
    }
  }

  destroyVoiceConnection() {
    const existing = getVoiceConnection(this.guildId);

    for (const connection of [this.connection, existing]) {
      if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) continue;
      try {
        connection.destroy();
      } catch {
        // The connection can be destroyed by Discord voice while we are reconnecting.
      }
    }

    this.connection = null;
  }

  createVoiceConnection(voiceChannel) {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      debug: config.music.voiceDebug,
      selfDeaf: true
    });

    connection.on('stateChange', (oldState, newState) => {
      console.log(
        `[music] Voice state ${oldState.status} -> ${newState.status} ` +
        `guild=${this.guildId} channel=${voiceChannel.id}`
      );
    });

    connection.on('error', error => {
      console.error(`[music] Voice connection error guild=${this.guildId}:`, error);
    });

    if (config.music.voiceDebug) {
      connection.on('debug', message => {
        console.log(`[music] Voice debug guild=${this.guildId} channel=${voiceChannel.id}: ${message}`);
      });
    }

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000)
        ]);
      } catch {
        if (this.connection === connection) {
          this.destroyVoiceConnection();
        }
      }
    });

    this.connection = connection;
    this.voiceChannelId = voiceChannel.id;
    this.connection.subscribe(this.player);
  }

  async connect(voiceChannel) {
    this.clearIdleTimer();

    for (let attempt = 1; attempt <= VOICE_CONNECT_ATTEMPTS; attempt++) {
      this.destroyVoiceConnection();
      this.createVoiceConnection(voiceChannel);

      try {
        await entersState(this.connection, VoiceConnectionStatus.Ready, VOICE_READY_TIMEOUT_MS);
        return;
      } catch (error) {
        const status = this.connection?.state?.status || 'unknown';
        console.warn(
          `[music] Voice Ready timeout attempt=${attempt}/${VOICE_CONNECT_ATTEMPTS} ` +
          `guild=${this.guildId} channel=${voiceChannel.id} status=${status}: ${getErrorMessage(error)}`
        );
        this.destroyVoiceConnection();
      }
    }

    throw new Error(
      'Bot wszedl na kanal, ale Discord Voice nie zestawil audio. ' +
      'Sprawdz uprawnienia Connect/Speak dla bota oraz czy serwer/Docker ma wyjscie UDP do Discord Voice.'
    );
  }

  async enqueue(tracks, voiceChannel, textChannel) {
    this.textChannelId = textChannel?.id || this.textChannelId;
    await this.connect(voiceChannel);

    this.queue.push(...tracks);
    if (!this.current && this.player.state.status === AudioPlayerStatus.Idle) {
      await this.playNext();
    } else {
      await updatePanel(this.client, this.guildId);
    }
  }

  async playNext() {
    this.clearIdleTimer();
    const nextTrack = this.queue.shift();

    if (!nextTrack) {
      this.current = null;
      await updatePanel(this.client, this.guildId);
      this.scheduleIdleDisconnect();
      return;
    }

    this.current = nextTrack;

    try {
      this.killCurrentProcess();
      const subprocess = spawnYtDlpAudio(nextTrack.url);

      this.currentProcess = subprocess;

      subprocess.on('error', error => {
        if (this.currentProcess === subprocess) {
          console.warn(`[music] Nie udalo sie uruchomic yt-dlp: ${error.message}`);
        }
      });

      subprocess.stderr?.on('data', chunk => {
        const message = String(chunk).trim();
        if (message) console.warn(`[music] yt-dlp: ${message}`);
      });

      const resource = createAudioResource(subprocess.stdout, {
        inputType: StreamType.Arbitrary,
        metadata: nextTrack
      });

      this.player.play(resource);
      await updatePanel(this.client, this.guildId);
    } catch (error) {
      console.error(`[music] Nie udalo sie odtworzyc "${nextTrack.title}":`, error.message);
      this.current = null;
      await this.playNext();
    }
  }

  pause() {
    return this.player.pause();
  }

  resume() {
    return this.player.unpause();
  }

  skip() {
    if (!this.current && this.queue.length === 0) return false;
    this.killCurrentProcess();
    this.player.stop(true);
    return true;
  }

  stop() {
    this.queue = [];
    this.current = null;
    this.killCurrentProcess();
    this.player.stop(true);
    this.scheduleIdleDisconnect(true);
  }

  destroy() {
    this.clearIdleTimer();
    this.killCurrentProcess();
    this.queue = [];
    this.current = null;
    this.destroyVoiceConnection();
    this.voiceChannelId = null;
  }

  scheduleIdleDisconnect(force = false) {
    this.clearIdleTimer();
    const delay = force ? 1000 : this.settings.idleDisconnectMs;

    this.idleTimer = setTimeout(() => {
      if (!this.current && this.queue.length === 0) {
        this.destroy();
        updatePanel(this.client, this.guildId).catch(() => {});
      }
    }, delay);
  }
}

function getGuildPlayer(client, guildId) {
  if (!guildPlayers.has(guildId)) {
    guildPlayers.set(guildId, new GuildMusicPlayer(client, guildId));
  }
  return guildPlayers.get(guildId);
}

function assertGuildInteraction(interaction) {
  if (!interaction.guildId || !interaction.guild) {
    throw new Error('Muzyka dziala tylko na serwerze Discord.');
  }
}

function assertTextChannelAllowed(interaction) {
  const settings = getSettings();
  if (settings.textChannelId && interaction.channelId !== settings.textChannelId) {
    throw new Error(`Muzyke obslugujemy na kanale <#${settings.textChannelId}>.`);
  }
}

async function getTargetVoiceChannel(interaction) {
  assertGuildInteraction(interaction);
  const settings = getSettings();
  const memberVoiceChannel = interaction.member?.voice?.channel || null;
  const targetVoiceChannel = settings.voiceChannelId
    ? await interaction.guild.channels.fetch(settings.voiceChannelId).catch(() => null)
    : memberVoiceChannel;

  if (!targetVoiceChannel) {
    throw new Error(settings.voiceChannelId
      ? `Nie moge znalezc kanalu glosowego <#${settings.voiceChannelId}>.`
      : 'Wejdz najpierw na kanal glosowy.');
  }

  if (settings.voiceChannelId && memberVoiceChannel?.id !== settings.voiceChannelId) {
    throw new Error(`Wejdz na kanal glosowy <#${settings.voiceChannelId}>, aby sterowac muzyka.`);
  }

  if (targetVoiceChannel.joinable === false || targetVoiceChannel.speakable === false) {
    throw new Error('Bot nie ma uprawnien do wejscia albo mowienia na tym kanale.');
  }

  return targetVoiceChannel;
}

async function addInputFromInteraction(interaction, input) {
  assertGuildInteraction(interaction);
  assertTextChannelAllowed(interaction);

  const player = getGuildPlayer(interaction.client, interaction.guildId);
  const settings = getSettings();
  const remainingSlots = settings.maxQueueSize - player.queue.length - (player.current ? 1 : 0);
  const tracks = await resolveInputToTracks(input, interaction.user, remainingSlots);
  const voiceChannel = await getTargetVoiceChannel(interaction);

  await player.enqueue(tracks, voiceChannel, interaction.channel);

  return {
    added: tracks.length,
    firstTrack: tracks[0],
    queueLength: player.queue.length,
    spotifyNotice: isSpotifyUrl(input)
  };
}

function buildQueueEmbed(player) {
  const lines = [];
  if (player.current) {
    lines.push(`Teraz: **${clipText(player.current.title, 80)}**`);
  }

  if (player.queue.length > 0) {
    player.queue.slice(0, 10).forEach((track, index) => {
      lines.push(`${index + 1}. ${clipText(track.title, 80)} (${track.durationText || 'brak czasu'})`);
    });
  }

  if (lines.length === 0) {
    lines.push('Kolejka jest pusta.');
  }

  if (player.queue.length > 10) {
    lines.push(`...i jeszcze ${player.queue.length - 10} utworow.`);
  }

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('Kolejka muzyki')
    .setDescription(lines.join('\n'));
}

function buildPanelEmbed(player) {
  const settings = getSettings();
  const current = player.current;
  const queuePreview = player.queue
    .slice(0, 5)
    .map((track, index) => `${index + 1}. ${clipText(track.title, 70)}`)
    .join('\n') || 'Brak utworow w kolejce.';

  const embed = new EmbedBuilder()
    .setColor(current ? 0x2ECC71 : 0x5865F2)
    .setTitle('Panel muzyki')
    .setDescription(current
      ? `Teraz gra: **${clipText(current.title, 180)}**`
      : 'Nic teraz nie gra. Uzyj przycisku Szukaj albo komendy /muzyka graj.')
    .addFields(
      {
        name: 'Status',
        value: getStatusLabel(player.player.state.status),
        inline: true
      },
      {
        name: 'Kanal glosowy',
        value: player.voiceChannelId
          ? `<#${player.voiceChannelId}>`
          : settings.voiceChannelId
            ? `<#${settings.voiceChannelId}>`
            : 'wedlug uzytkownika',
        inline: true
      },
      {
        name: 'W kolejce',
        value: String(player.queue.length),
        inline: true
      },
      {
        name: 'Nastepne',
        value: queuePreview,
        inline: false
      }
    )
    .setFooter({
      text: 'Spotify jest obslugiwane jako wyszukiwanie po metadanych; audio gra z publicznych zrodel.'
    })
    .setTimestamp();

  if (current?.thumbnail) {
    embed.setThumbnail(current.thumbnail);
  }

  if (current?.url) {
    embed.setURL(current.url);
  }

  return embed;
}

function buildControlRows(player) {
  const hasCurrent = Boolean(player.current);
  const hasQueue = player.queue.length > 0;

  const firstRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BUTTONS.search)
      .setLabel('Szukaj')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(BUTTONS.resume)
      .setLabel('Play')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!hasCurrent || player.isPlaying),
    new ButtonBuilder()
      .setCustomId(BUTTONS.pause)
      .setLabel('Pauza')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasCurrent || player.isPaused),
    new ButtonBuilder()
      .setCustomId(BUTTONS.next)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasCurrent && !hasQueue),
    new ButtonBuilder()
      .setCustomId(BUTTONS.stop)
      .setLabel('Stop')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasCurrent && !hasQueue)
  );

  const secondRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BUTTONS.queue)
      .setLabel('Kolejka')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(BUTTONS.leave)
      .setLabel('Rozlacz')
      .setStyle(ButtonStyle.Secondary)
  );

  return [firstRow, secondRow];
}

async function updatePanel(client, guildId) {
  const panelRef = getPanelRef(guildId);
  if (!panelRef) return null;

  const channel = await client.channels.fetch(panelRef.channelId).catch(() => null);
  if (!channel?.isTextBased()) return null;

  const message = await channel.messages.fetch(panelRef.messageId).catch(() => null);
  if (!message) return null;

  const player = getGuildPlayer(client, guildId);
  await message.edit({
    embeds: [buildPanelEmbed(player)],
    components: buildControlRows(player)
  });
  return message;
}

async function publishPanel(interaction, targetChannel = interaction.channel) {
  assertGuildInteraction(interaction);
  if (!targetChannel?.isTextBased()) {
    throw new Error('Panel muzyki musi trafic na kanal tekstowy.');
  }

  const player = getGuildPlayer(interaction.client, interaction.guildId);
  const message = await targetChannel.send({
    embeds: [buildPanelEmbed(player)],
    components: buildControlRows(player)
  });

  rememberPanel(interaction.guildId, targetChannel.id, message.id);
  updateMusicSettings({ textChannelId: targetChannel.id });
  return message;
}

async function showSearchResults(interaction, query) {
  assertGuildInteraction(interaction);
  assertTextChannelAllowed(interaction);

  const settings = getSettings();
  const results = await searchYouTube(query, settings.searchLimit);
  if (results.length === 0) {
    await interaction.editReply('Nie znalazlem zadnych wynikow.');
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${SEARCH_SELECT_PREFIX}${interaction.user.id}`)
    .setPlaceholder('Wybierz utwor do kolejki')
    .addOptions(results.map((track, index) => ({
      label: clipText(`${index + 1}. ${track.title}`, 100),
      description: clipText(`${track.channelName || 'YouTube'} | ${track.durationText || 'brak czasu'}`, 100),
      value: `${index}|${track.url}`
    })));

  await interaction.editReply({
    content: `Wyniki dla: **${clipText(query, 120)}**`,
    components: [new ActionRowBuilder().addComponents(menu)]
  });
}

async function showQueue(interaction) {
  assertGuildInteraction(interaction);
  const player = getGuildPlayer(interaction.client, interaction.guildId);
  await interaction.editReply({ embeds: [buildQueueEmbed(player)] });
}

function buildSearchModal() {
  const input = new TextInputBuilder()
    .setCustomId(SEARCH_INPUT_ID)
    .setLabel('Nazwa utworu albo link')
    .setPlaceholder('np. Metallica Nothing Else Matters albo link YouTube/Spotify')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(250);

  return new ModalBuilder()
    .setCustomId(SEARCH_MODAL_ID)
    .setTitle('Szukaj muzyki')
    .addComponents(new ActionRowBuilder().addComponents(input));
}

async function handleButton(interaction) {
  if (!Object.values(BUTTONS).includes(interaction.customId)) return false;

  assertGuildInteraction(interaction);
  const player = getGuildPlayer(interaction.client, interaction.guildId);

  if (interaction.customId === BUTTONS.search) {
    await interaction.showModal(buildSearchModal());
    return true;
  }

  await interaction.deferReply({ flags: EPHEMERAL_FLAGS });

  try {
    assertTextChannelAllowed(interaction);

    if (interaction.customId === BUTTONS.pause) {
      player.pause();
      await updatePanel(interaction.client, interaction.guildId);
      await interaction.editReply('Pauza.');
      return true;
    }

    if (interaction.customId === BUTTONS.resume) {
      player.resume();
      await updatePanel(interaction.client, interaction.guildId);
      await interaction.editReply('Gram dalej.');
      return true;
    }

    if (interaction.customId === BUTTONS.next) {
      player.skip();
      await interaction.editReply('Pomijam utwor.');
      return true;
    }

    if (interaction.customId === BUTTONS.stop) {
      player.stop();
      await updatePanel(interaction.client, interaction.guildId);
      await interaction.editReply('Zatrzymano i wyczyszczono kolejke.');
      return true;
    }

    if (interaction.customId === BUTTONS.queue) {
      await interaction.editReply({ embeds: [buildQueueEmbed(player)] });
      return true;
    }

    if (interaction.customId === BUTTONS.leave) {
      player.destroy();
      await updatePanel(interaction.client, interaction.guildId);
      await interaction.editReply('Rozlaczono z kanalem glosowym.');
      return true;
    }
  } catch (error) {
    console.error('[music] Blad przycisku:', error);
    await interaction.editReply(error.message || 'Nie udalo sie wykonac akcji.');
    return true;
  }

  return false;
}

async function handleModal(interaction) {
  if (interaction.customId !== SEARCH_MODAL_ID) return false;

  await interaction.deferReply({ flags: EPHEMERAL_FLAGS });
  try {
    const query = interaction.fields.getTextInputValue(SEARCH_INPUT_ID);
    await showSearchResults(interaction, query);
  } catch (error) {
    console.error('[music] Blad modala wyszukiwania:', error);
    await interaction.editReply(error.message || 'Nie udalo sie wyszukac utworu.');
  }
  return true;
}

async function handleSelect(interaction) {
  if (!interaction.customId.startsWith(SEARCH_SELECT_PREFIX)) return false;

  await interaction.deferReply({ flags: EPHEMERAL_FLAGS });
  try {
    const allowedUserId = interaction.customId.slice(SEARCH_SELECT_PREFIX.length);
    if (allowedUserId && allowedUserId !== interaction.user.id) {
      await interaction.editReply('To menu wyszukiwania nalezy do innego uzytkownika.');
      return true;
    }

    const selectedUrl = String(interaction.values[0] || '').replace(/^\d+\|/, '');
    const result = await addInputFromInteraction(interaction, selectedUrl);
    await updatePanel(interaction.client, interaction.guildId);
    await interaction.editReply(
      `Dodano do kolejki: **${clipText(result.firstTrack.title, 120)}**.`
    );
  } catch (error) {
    console.error('[music] Blad wyboru wyniku:', error);
    await interaction.editReply(error.message || 'Nie udalo sie dodac utworu.');
  }
  return true;
}

function setupMusic(client) {
  client.on('interactionCreate', async interaction => {
    try {
      if (interaction.isButton()) {
        await handleButton(interaction);
      } else if (interaction.isModalSubmit()) {
        await handleModal(interaction);
      } else if (interaction.isStringSelectMenu()) {
        await handleSelect(interaction);
      }
    } catch (error) {
      console.error('[music] Blad interakcji:', error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('Wystapil blad modulu muzyki.').catch(() => {});
      } else {
        await interaction.reply({
          content: 'Wystapil blad modulu muzyki.',
          flags: EPHEMERAL_FLAGS
        }).catch(() => {});
      }
    }
  });
}

module.exports = {
  setupMusic,
  addInputFromInteraction,
  publishPanel,
  showSearchResults,
  showQueue,
  updateMusicSettings,
  getSettings,
  getGuildPlayer,
  updatePanel,
  clipText
};
