/**
 * Video playback plumbing: turning an addon stream into something playable,
 * handing it to the watch screen, and remembering where you stopped.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { fetchStreams } from './addons';
import { getActiveAddons, getTorboxKey } from './storage';
import * as torbox from './torbox';
import type { Stream } from './types';

// --- What to play -----------------------------------------------------------

export type EpisodeRef = { id: string; label: string };

export type WatchItem = {
  /** Identifies the movie/episode/channel for resume. */
  key: string;
  title: string;
  subtitle?: string;
  poster?: string;
  uri: string;
  headers?: Record<string, string>;
  live?: boolean;
  /** Where "continue watching" should take you back to. */
  link?: { type: string; id: string };
  /** The show's episodes in order, so the player can offer "Next episode". */
  series?: { metaId: string; episodes: EpisodeRef[] };
  /** Where this stream came from, to pick the same kind of stream for the next episode. */
  source?: { addonId: string; bingeGroup?: string };
};

let nowWatching: WatchItem | null = null;

/** The watch screen reads this instead of stuffing long URLs into route params. */
export function setNowWatching(item: WatchItem) {
  nowWatching = item;
}

export function getNowWatching() {
  return nowWatching;
}

// The title page stores the episode list here when you open an episode, so the
// stream list can pass it on to the player without long route params.
let seriesContext: WatchItem['series'] | null = null;

export function setSeriesContext(ctx: WatchItem['series']) {
  seriesContext = ctx;
}

export function getSeriesContext(metaId: string) {
  return seriesContext?.metaId === metaId ? seriesContext : undefined;
}

export function nextEpisode(item: WatchItem): EpisodeRef | undefined {
  const eps = item.series?.episodes ?? [];
  const i = eps.findIndex((e) => e.id === item.key);
  return i >= 0 ? eps[i + 1] : undefined;
}

// --- Resolving streams ------------------------------------------------------

export type StreamResult =
  | { status: 'ready'; uri: string; headers?: Record<string, string> }
  | { status: 'downloading'; itemId: number; progress: number }
  | { status: 'external'; url: string };

function pickFile(item: torbox.TorboxItem, stream: Stream) {
  const videos = item.files.filter(torbox.isVideoFile);
  const wanted = stream.behaviorHints?.filename?.toLowerCase();
  return (
    (wanted && videos.find((f) => f.name.toLowerCase().endsWith(wanted))) ||
    (stream.fileIdx !== undefined && videos.find((f) => f.id === stream.fileIdx)) ||
    [...videos].sort((a, b) => b.size - a.size)[0]
  );
}

export async function checkTorboxStream(itemId: number, stream: Stream): Promise<StreamResult> {
  const item = await torbox.getItem('torrent', itemId);
  if (!item.download_finished) return { status: 'downloading', itemId, progress: item.progress };
  const file = pickFile(item, stream);
  if (!file) throw new Error('TorBox finished, but there is no video file in this torrent');
  return {
    status: 'ready',
    uri: await torbox.requestLink('torrent', itemId, file.id),
  };
}

export async function resolveStream(stream: Stream, name: string): Promise<StreamResult> {
  if (stream.url) {
    return {
      status: 'ready',
      uri: stream.url,
      headers: stream.behaviorHints?.proxyHeaders?.request,
    };
  }
  if (stream.infoHash) {
    const { id } = await torbox.addMagnet(torbox.magnetFromHash(stream.infoHash, name), name);
    return checkTorboxStream(id, stream);
  }
  if (stream.externalUrl) return { status: 'external', url: stream.externalUrl };
  throw new Error('This stream has nothing playable in it');
}

// --- Next episode ---------------------------------------------------------

export type NextPick = { stream: Stream; addonId: string };

/**
 * Picks a stream for the next episode, preferring (in order): the same addon and
 * release group as now, then the same addon, then anything that starts instantly
 * (direct link or cached on TorBox), then any torrent.
 */
export async function pickNextStream(
  episodeId: string,
  source: WatchItem['source'],
): Promise<NextPick | null> {
  const groups = await fetchStreams(await getActiveAddons(), 'series', episodeId);
  const all = groups.flatMap((g) =>
    g.streams.map((stream) => ({ stream, addonId: g.addon.manifest.id })),
  );
  if (!all.length) return null;

  let cached = new Set<string>();
  const hashes = all.map((c) => c.stream.infoHash).filter(Boolean) as string[];
  if (hashes.length && (await getTorboxKey()))
    cached = await torbox.checkCached(hashes).catch(() => cached);
  const instant = (s: Stream) => !!s.url || (!!s.infoHash && cached.has(s.infoHash.toLowerCase()));

  const score = ({ stream, addonId }: NextPick) =>
    (source &&
    addonId === source.addonId &&
    source.bingeGroup &&
    stream.behaviorHints?.bingeGroup === source.bingeGroup
      ? 8
      : 0) +
    (source && addonId === source.addonId ? 4 : 0) +
    (instant(stream) ? 2 : 0) +
    (stream.url || stream.infoHash ? 1 : 0);

  // Stable: ties keep the addon's own order (usually best first).
  return [...all].sort((a, b) => score(b) - score(a))[0];
}

// --- Continue watching ------------------------------------------------------

const PROGRESS_KEY = '128bit.watch';
const MAX_ITEMS = 30;

export type WatchProgress = {
  key: string;
  title: string;
  subtitle?: string;
  poster?: string;
  position: number;
  duration: number;
  updatedAt: number;
  link?: { type: string; id: string };
};

export async function getWatchProgress(): Promise<WatchProgress[]> {
  try {
    const raw = await AsyncStorage.getItem(PROGRESS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

const HIDDEN_KEY = '128bit.continueHidden';

/** Items you removed from Continue watching (so Trakt's copy stays hidden too). */
export async function getHiddenContinue(): Promise<Set<string>> {
  try {
    return new Set(JSON.parse((await AsyncStorage.getItem(HIDDEN_KEY)) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/** Hold an item in Continue watching → remove it (until you watch it again). */
export async function removeWatchProgress(key: string) {
  const all = await getWatchProgress();
  await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(all.filter((p) => p.key !== key)));
  const hidden = await getHiddenContinue();
  hidden.add(key);
  await AsyncStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden].slice(-500)));
}

export async function saveWatchProgress(entry: Omit<WatchProgress, 'updatedAt'>) {
  // Watching it again brings it back.
  const hidden = await getHiddenContinue();
  if (hidden.delete(entry.key)) await AsyncStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
  const all = await getWatchProgress();
  const finished = entry.duration > 0 && entry.position / entry.duration > 0.95;
  const rest = all.filter((p) => p.key !== entry.key);
  const next = finished ? rest : [{ ...entry, updatedAt: Date.now() }, ...rest].slice(0, MAX_ITEMS);
  await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
}

// --- Anime (English audio + subtitles first) ---------------------------------------

const ANIME_KEY = '128bit.animeIds';
const ANIME_ID = /^(kitsu|mal|anilist|anidb|ani):/i;
let animeIds: Set<string> | null = null;

async function loadAnimeIds() {
  if (!animeIds) {
    try {
      animeIds = new Set(JSON.parse((await AsyncStorage.getItem(ANIME_KEY)) ?? '[]') as string[]);
    } catch {
      animeIds = new Set();
    }
  }
  return animeIds;
}

/** Remembers that a title came from the Anime tab (an anime catalog). */
export async function markAnime(id: string) {
  const ids = await loadAnimeIds();
  if (ids.has(id)) return;
  ids.add(id);
  await AsyncStorage.setItem(ANIME_KEY, JSON.stringify([...ids].slice(-500)));
}

/** Anime: an anime type or id (Kitsu, MAL…), or opened from the Anime tab. */
export async function isAnime(link?: { type: string; id: string }) {
  if (!link) return false;
  if (link.type === 'anime' || ANIME_ID.test(link.id)) return true;
  return (await loadAnimeIds()).has(link.id);
}
