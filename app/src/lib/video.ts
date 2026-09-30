/**
 * Video playback plumbing: turning an addon stream into something playable,
 * handing it to the watch screen, and remembering where you stopped.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import * as torbox from './torbox';
import type { Stream } from './types';

// --- What to play -----------------------------------------------------------

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
};

let nowWatching: WatchItem | null = null;

/** The watch screen reads this instead of stuffing long URLs into route params. */
export function setNowWatching(item: WatchItem) {
  nowWatching = item;
}

export function getNowWatching() {
  return nowWatching;
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

export async function saveWatchProgress(entry: Omit<WatchProgress, 'updatedAt'>) {
  const all = await getWatchProgress();
  const finished = entry.duration > 0 && entry.position / entry.duration > 0.95;
  const rest = all.filter((p) => p.key !== entry.key);
  const next = finished ? rest : [{ ...entry, updatedAt: Date.now() }, ...rest].slice(0, MAX_ITEMS);
  await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
}
