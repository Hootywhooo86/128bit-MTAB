/**
 * Minimal TorBox API client.
 * Spec: https://api.torbox.app/docs (OpenAPI at https://api.torbox.app/openapi.json)
 */
import { getTorboxKey } from './storage';

const BASE = 'https://api.torbox.app/v1/api';

export type TorboxFile = {
  id: number;
  name: string;
  short_name?: string;
  size: number;
  mimetype?: string;
};

export type TorboxItem = {
  id: number;
  hash?: string;
  name: string;
  size: number;
  /** 0..1 */
  progress: number;
  download_state?: string;
  download_finished: boolean;
  files: TorboxFile[];
  kind: 'torrent' | 'webdl';
};

type Envelope<T> = { success: boolean; error?: string | null; detail?: string; data: T };

export class TorboxError extends Error {}

async function requireKey(): Promise<string> {
  const key = await getTorboxKey();
  if (!key) throw new TorboxError('Add your TorBox API key in Settings first.');
  return key;
}

async function call<T>(path: string, init: RequestInit = {}, key?: string): Promise<T> {
  const apiKey = key ?? (await requireKey());
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, ...(init.headers ?? {}) },
  });
  let body: Envelope<T> | undefined;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    // fall through to the status check below
  }
  if (!res.ok || !body?.success) {
    throw new TorboxError(body?.detail || body?.error || `TorBox request failed (${res.status})`);
  }
  return body.data;
}

export const AUDIO_EXT = /\.(mp3|m4a|m4b|aac|ogg|opus|flac|wav)$/i;

export function isAudioFile(f: TorboxFile) {
  return f.mimetype?.startsWith('audio/') || AUDIO_EXT.test(f.name);
}

export const VIDEO_EXT = /\.(mkv|mp4|m4v|avi|mov|webm|ts|m2ts|wmv)$/i;

export function isVideoFile(f: TorboxFile) {
  return f.mimetype?.startsWith('video/') || VIDEO_EXT.test(f.name);
}

/** Natural sort so "Chapter 2" comes before "Chapter 10". */
export function sortFiles(files: TorboxFile[]) {
  return [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

// --- Account ----------------------------------------------------------------

export async function testKey(key: string): Promise<{ email?: string; plan?: number }> {
  return call('/user/me', {}, key);
}

// --- Listing ----------------------------------------------------------------

function normalize(raw: any, kind: TorboxItem['kind']): TorboxItem {
  return {
    id: raw.id,
    hash: raw.hash,
    name: raw.name ?? 'Untitled',
    size: raw.size ?? 0,
    progress: raw.progress ?? 0,
    download_state: raw.download_state,
    download_finished: !!raw.download_finished,
    files: raw.files ?? [],
    kind,
  };
}

export async function listTorrents(): Promise<TorboxItem[]> {
  const data = await call<any[]>('/torrents/mylist?bypass_cache=true');
  return (data ?? []).map((t) => normalize(t, 'torrent'));
}

export async function listWebDownloads(): Promise<TorboxItem[]> {
  const data = await call<any[]>('/webdl/mylist?bypass_cache=true');
  return (data ?? []).map((t) => normalize(t, 'webdl'));
}

export async function getItem(kind: TorboxItem['kind'], id: number): Promise<TorboxItem> {
  const path = kind === 'torrent' ? '/torrents/mylist' : '/webdl/mylist';
  const data = await call<any>(`${path}?bypass_cache=true&id=${id}`);
  return normalize(data, kind);
}

/** Everything in the user's TorBox cloud that contains at least one audio file. */
export async function listAudioItems(): Promise<TorboxItem[]> {
  const [torrents, webdls] = await Promise.all([
    listTorrents(),
    listWebDownloads().catch(() => [] as TorboxItem[]),
  ]);
  return [...torrents, ...webdls].filter(
    (item) => !item.download_finished || item.files.some(isAudioFile),
  );
}

// --- Adding -----------------------------------------------------------------

export function magnetFromHash(infoHash: string, name?: string) {
  const dn = name ? `&dn=${encodeURIComponent(name)}` : '';
  return `magnet:?xt=urn:btih:${infoHash}${dn}`;
}

function hashFromMagnet(magnet: string) {
  return magnet.match(/btih:([a-z0-9]+)/i)?.[1]?.toLowerCase();
}

/** Adds a torrent to TorBox, or returns the existing one if it is already in the account. */
export async function addMagnet(magnet: string, name?: string): Promise<{ id: number }> {
  const hash = hashFromMagnet(magnet);
  if (hash) {
    const existing = (await listTorrents()).find((t) => t.hash?.toLowerCase() === hash);
    if (existing) return { id: existing.id };
  }
  const form = new FormData();
  form.append('magnet', magnet);
  if (name) form.append('name', name);
  const data = await call<{ torrent_id: number }>('/torrents/createtorrent', {
    method: 'POST',
    body: form,
  });
  return { id: data.torrent_id };
}

export async function addWebDownload(link: string, name?: string): Promise<{ id: number }> {
  const body = new URLSearchParams({ link, ...(name ? { name } : {}) });
  const data = await call<{ webdownload_id: number }>('/webdl/createwebdownload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  return { id: data.webdownload_id };
}

/** Which of these torrent hashes TorBox already has cached (they start instantly). */
export async function checkCached(hashes: string[]): Promise<Set<string>> {
  if (!hashes.length) return new Set();
  const unique = [...new Set(hashes.map((h) => h.toLowerCase()))];
  const data = await call<Record<string, unknown> | null>(
    `/torrents/checkcached?format=object&hash=${unique.join(',')}`,
  );
  return new Set(Object.keys(data ?? {}).map((h) => h.toLowerCase()));
}

// --- Streaming links --------------------------------------------------------

/** Returns a short-lived direct link for one file. */
export async function requestLink(
  kind: TorboxItem['kind'],
  itemId: number,
  fileId: number,
): Promise<string> {
  const key = await requireKey();
  const qs =
    kind === 'torrent'
      ? `token=${key}&torrent_id=${itemId}&file_id=${fileId}`
      : `token=${key}&web_id=${itemId}&file_id=${fileId}`;
  const path = kind === 'torrent' ? '/torrents/requestdl' : '/webdl/requestdl';
  return call<string>(`${path}?${qs}`, {}, key);
}
