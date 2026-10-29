/**
 * Movies and episodes saved to the phone. A stream with a direct link downloads
 * straight away; a torrent goes to TorBox first and downloads when TorBox has
 * it (checked every minute while the app is open). Live/HLS streams can't be saved.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, DownloadTask, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import * as torbox from './torbox';
import type { Stream } from './types';
import { checkTorboxStream } from './video';

const KEY = '128bit.videoDownloads';

export type VideoDownload = {
  /** Movie id ("tt…") or episode id ("tt…:1:2"); also the resume key. */
  key: string;
  kind: 'movie' | 'episode';
  /** Movie or show title. */
  title: string;
  /** Episode label, e.g. "S1 E2 · Pilot". */
  subtitle?: string;
  poster?: string;
  link?: { type: string; id: string };
  state: 'torbox' | 'downloading' | 'paused' | 'done' | 'error';
  progress: number;
  bytes?: number;
  error?: string;
  file?: string;
  torboxId?: number;
  stream: Stream;
  addedAt: number;
  /** Downloaded by "Keep next episodes" (deleted again once you've watched past it). */
  auto?: boolean;
};

export const videoDownloadsSupported = Platform.OS !== 'web';

let cache: VideoDownload[] | null = null;
const tasks = new Map<string, DownloadTask>();
const listeners = new Set<(list: VideoDownload[]) => void>();

export async function getVideoDownloads(): Promise<VideoDownload[]> {
  if (!cache) {
    try {
      cache = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]') as VideoDownload[];
    } catch {
      cache = [];
    }
    // Downloads cut off by the app closing restart from where they can.
    cache = cache.map((d) => (d.state === 'downloading' ? { ...d, state: 'paused' } : d));
  }
  return cache;
}

export function onVideoDownloads(fn: (list: VideoDownload[]) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
async function patch(key: string, change: Partial<VideoDownload>) {
  const list = await getVideoDownloads();
  cache = list.map((d) => (d.key === key ? { ...d, ...change } : d));
  listeners.forEach((l) => l(cache!));
  // Progress updates are frequent: write at most once a second.
  if (!saveTimer) {
    saveTimer = setTimeout(() => {
      saveTimer = null;
      AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => {});
    }, 1000);
  }
}

async function setAll(list: VideoDownload[]) {
  cache = list;
  listeners.forEach((l) => l(list));
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}

export async function getVideoDownload(key: string) {
  return (await getVideoDownloads()).find((d) => d.key === key && d.state === 'done' && d.file);
}

const safe = (s: string) => s.replace(/[^a-z0-9._-]+/gi, '_');

function extOf(stream: Stream, url: string) {
  const name = stream.behaviorHints?.filename ?? url.split('?')[0];
  return name.match(/\.(mkv|mp4|m4v|avi|mov|webm|ts)$/i)?.[1]?.toLowerCase() ?? 'mp4';
}

async function startFile(d: VideoDownload, url: string, headers?: Record<string, string>) {
  const dir = new Directory(Paths.document, 'videos');
  dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, `${safe(d.key)}.${extOf(d.stream, url)}`);
  if (file.exists) file.delete();
  const task = new DownloadTask(url, file, {
    headers,
    onProgress: ({ bytesWritten, totalBytes }) => {
      patch(d.key, {
        progress: totalBytes > 0 ? bytesWritten / totalBytes : 0,
        bytes: totalBytes > 0 ? totalBytes : bytesWritten,
      });
    },
  });
  tasks.set(d.key, task);
  await patch(d.key, { state: 'downloading', progress: 0, error: undefined, file: file.uri });
  try {
    const done = await task.downloadAsync();
    if (done) await patch(d.key, { state: 'done', progress: 1, bytes: done.size ?? undefined });
  } catch (e) {
    if (task.state !== 'cancelled') {
      await patch(d.key, { state: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  } finally {
    tasks.delete(d.key);
  }
}

/** Gets the file's link (asking TorBox if needed) and starts downloading it. */
async function begin(d: VideoDownload) {
  const s = d.stream;
  if (s.url) {
    if (/\.m3u8(\?|$)/i.test(s.url)) {
      throw new Error('This is a live/HLS stream; it can only be streamed, not saved.');
    }
    return startFile(d, s.url, s.behaviorHints?.proxyHeaders?.request);
  }
  if (s.infoHash) {
    let torboxId = d.torboxId;
    if (!torboxId) {
      const name = d.subtitle ? `${d.title} ${d.subtitle}` : d.title;
      torboxId = (await torbox.addMagnet(torbox.magnetFromHash(s.infoHash, name), name, 'video')).id;
      await patch(d.key, { torboxId });
    }
    const r = await checkTorboxStream(torboxId, s);
    if (r.status === 'ready') return startFile(d, r.uri);
    if (r.status === 'downloading') return patch(d.key, { state: 'torbox', progress: r.progress });
  }
  throw new Error('This stream has no file that can be saved');
}

/** Long-press a stream: save it to the phone. */
export async function downloadVideo(input: Omit<VideoDownload, 'state' | 'progress' | 'addedAt'>) {
  if (!videoDownloadsSupported) throw new Error('Downloads work in the phone app, not on the web.');
  const list = await getVideoDownloads();
  const entry: VideoDownload = { ...input, state: 'torbox', progress: 0, addedAt: Date.now() };
  await setAll([entry, ...list.filter((d) => d.key !== input.key)]);
  begin(entry).catch((e) => patch(entry.key, { state: 'error', error: e instanceof Error ? e.message : String(e) }));
}

export async function pauseVideo(key: string) {
  const task = tasks.get(key);
  if (task) await task.pauseAsync().catch(() => task.cancel());
  tasks.delete(key);
  await patch(key, { state: 'paused' });
}

/** Resume or retry: starts the file again (TorBox links are fetched fresh). */
export async function resumeVideo(key: string) {
  const d = (await getVideoDownloads()).find((x) => x.key === key);
  if (!d) return;
  await patch(key, { state: d.stream.infoHash ? 'torbox' : 'downloading', error: undefined });
  begin(d).catch((e) => patch(key, { state: 'error', error: e instanceof Error ? e.message : String(e) }));
}

export async function deleteVideo(key: string) {
  tasks.get(key)?.cancel();
  tasks.delete(key);
  const list = await getVideoDownloads();
  const d = list.find((x) => x.key === key);
  if (d?.file) {
    try {
      const f = new File(d.file);
      if (f.exists) f.delete();
    } catch {
      // Already gone.
    }
  }
  await setAll(list.filter((x) => x.key !== key));
}

let checking = false;
/** Starts downloads whose torrents TorBox has now finished. */
export async function runVideoQueue() {
  if (checking || !videoDownloadsSupported) return;
  checking = true;
  try {
    for (const d of await getVideoDownloads()) {
      if (d.state === 'torbox' && !tasks.has(d.key)) {
        await begin(d).catch((e) =>
          patch(d.key, { state: 'error', error: e instanceof Error ? e.message : String(e) }),
        );
      }
    }
  } finally {
    checking = false;
  }
}
