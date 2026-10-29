/**
 * What worked and what didn't, so picking a stream gets smarter over time:
 * - per show (or movie), the release group, quality and addon of the stream you last
 *   watched past the first minute, so the next episode prefers the same kind;
 * - streams that failed to play, so they drop out of the list (and auto-picks).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { parseStream, type Quality } from './stream-info';
import type { Stream } from './types';

const LIKED_KEY = '128bit.streamLiked';
const FAILED_KEY = '128bit.streamFailed';
const MAX_LIKED = 200;
const MAX_FAILED = 300;
/** A failure is forgotten after this long (the source may have been fixed). */
const FAILED_FOR_MS = 14 * 24 * 3600_000;

export type Liked = { addonId: string; group: string | null; quality: Quality | null; at: number };

type Store<T> = Record<string, T>;
let liked: Store<Liked> | null = null;
let failed: Store<number> | null = null;

async function load<T>(key: string): Promise<Store<T>> {
  try {
    return JSON.parse((await AsyncStorage.getItem(key)) ?? '{}') as Store<T>;
  } catch {
    return {};
  }
}

/** Keeps the newest `max` entries. */
function trim<T>(store: Store<T>, max: number, at: (v: T) => number) {
  const entries = Object.entries(store);
  if (entries.length <= max) return store;
  return Object.fromEntries(entries.sort((a, b) => at(b[1]) - at(a[1])).slice(0, max));
}

/** One stream, whichever addon lists it: its torrent (+ file) or its link. */
export function streamId(s: Stream) {
  if (s.infoHash) return `${s.infoHash.toLowerCase()}:${s.fileIdx ?? ''}`;
  return s.url ?? s.externalUrl ?? '';
}

/** The show (or movie) a stream belongs to, from an episode id like "tt123:1:2" or "kitsu:1:3". */
export const showOf = (id: string) =>
  /^kitsu:/.test(id) ? id.split(':').slice(0, 2).join(':') : id.replace(/:\d+:\d+$/, '');

/** Release group: "…x265-GROUP.mkv" or "[Group] Show - 03". */
export function releaseGroup(s: Stream): string | null {
  const name = s.behaviorHints?.filename ?? s.title?.split('\n')[0] ?? s.description?.split('\n')[0] ?? '';
  const anime = name.match(/^\s*\[([^\]]{2,30})\]/);
  if (anime) return anime[1].trim().toLowerCase();
  const tail = name.replace(/\.(mkv|mp4|avi|m4v|webm|ts)$/i, '').match(/-([A-Za-z0-9]{2,20})(?:\[[^\]]*\])?\s*$/);
  return tail ? tail[1].toLowerCase() : null;
}

/** You watched this stream past the first minute: prefer its kind for this show next time. */
export async function rememberLiked(itemId: string, s: Stream, addonId: string) {
  liked ??= await load<Liked>(LIKED_KEY);
  liked[showOf(itemId)] = { addonId, group: releaseGroup(s), quality: parseStream(s).quality, at: Date.now() };
  liked = trim(liked, MAX_LIKED, (v) => v.at);
  // It worked, so it isn't a failure any more.
  if (failed?.[streamId(s)]) delete failed[streamId(s)];
  await AsyncStorage.setItem(LIKED_KEY, JSON.stringify(liked));
}

export async function getLiked(itemId: string): Promise<Liked | null> {
  liked ??= await load<Liked>(LIKED_KEY);
  return liked[showOf(itemId)] ?? null;
}

/** This stream wouldn't play: hide it from now on (for two weeks). */
export async function rememberFailed(s: Stream) {
  const id = streamId(s);
  if (!id) return;
  failed ??= await load<number>(FAILED_KEY);
  failed[id] = Date.now();
  failed = trim(failed, MAX_FAILED, (v) => v);
  await AsyncStorage.setItem(FAILED_KEY, JSON.stringify(failed));
}

/** Streams that failed recently, by streamId. */
export async function getFailed(): Promise<Set<string>> {
  failed ??= await load<number>(FAILED_KEY);
  const now = Date.now();
  return new Set(Object.entries(failed).filter(([, at]) => now - at < FAILED_FOR_MS).map(([id]) => id));
}

/** How well a stream fits what you watched before (0 = nothing in common). */
export function likedScore(s: Stream, addonId: string, l: Liked | null) {
  if (!l) return 0;
  const group = releaseGroup(s);
  return (
    (l.group && group === l.group ? 4 : 0) +
    (l.quality && parseStream(s).quality === l.quality ? 2 : 0) +
    (addonId === l.addonId ? 1 : 0)
  );
}

/** Bigger than your size limit (0 = no limit; unknown sizes always pass). */
export function tooBig(s: Stream, maxGB: number) {
  if (!maxGB) return false;
  const size = parseStream(s).sizeBytes;
  return size !== null && size > maxGB * 1024 ** 3;
}
