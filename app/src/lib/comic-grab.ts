/**
 * Comics like audiobooks: find a comic on GetComics or The Pirate Bay (Comics),
 * tap it, and 128bit gets it onto the phone and into the reader.
 *
 * - GetComics posts have a "Download Now" link that redirects straight to the file,
 *   so those download directly to the phone (no TorBox needed).
 * - Pirate Bay torrents go to TorBox; when TorBox has them, the CBZ files inside are
 *   downloaded to the phone.
 * Either way the CBZ files are imported as a series (lib/comic-downloads).
 * CBR (RAR) can't be opened, so CBZ releases are listed first and CBR ones are marked.
 *
 * "Follow" a series to be told about new issues: GetComics and TPB are checked for the
 * next issue number every few hours while the app is open (optionally grabbing it).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { importCbzFiles, setSeriesCover } from './comic-downloads';
import { addMagnet, getItem, magnetFromHash, requestLink, type TorboxFile } from './torbox';

const WANTED_KEY = '128bit.comicWanted';
const FOLLOW_KEY = '128bit.comicFollows';
const SITES_KEY = '128bit.comicSites';
const TIMEOUT_MS = 15_000;
const FOLLOW_EVERY_MS = 6 * 3600_000;

export type ComicFormat = 'CBZ' | 'CBR' | 'PDF' | 'Pack' | 'Direct' | '?';

export type ComicRelease = {
  id: string;
  source: 'getcomics' | 'tpb';
  title: string;
  /** GetComics post page. */
  link?: string;
  infoHash?: string;
  size?: number;
  seeders?: number;
  files?: number;
  cover?: string;
  date?: string;
  format: ComicFormat;
  /** Issue number, when the title has one ("#12", "012"). */
  issue?: number;
};

export type ComicSites = { getcomics: string; tpb: string };
const DEFAULT_SITES: ComicSites = { getcomics: 'https://getcomics.org', tpb: 'https://apibay.org' };

export async function getComicSites(): Promise<ComicSites> {
  try {
    return { ...DEFAULT_SITES, ...JSON.parse((await AsyncStorage.getItem(SITES_KEY)) ?? '{}') };
  } catch {
    return DEFAULT_SITES;
  }
}

export async function setComicSites(sites: Partial<ComicSites>) {
  const clean = (u?: string) => u?.trim().replace(/\/+$/, '') || undefined;
  const next = { ...(await getComicSites()), ...sites };
  await AsyncStorage.setItem(
    SITES_KEY,
    JSON.stringify({
      getcomics: clean(next.getcomics) ?? DEFAULT_SITES.getcomics,
      tpb: clean(next.tpb) ?? DEFAULT_SITES.tpb,
    }),
  );
}

// --- Names ----------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
export const decodeHtml = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&(\w+);/g, (m, n) => ENTITIES[n] ?? m);

export function formatOf(name: string, files?: number): ComicFormat {
  if (/\.cbz\b/i.test(name)) return 'CBZ';
  if (/\.cbr\b/i.test(name)) return 'CBR';
  if (/\.pdf\b/i.test(name)) return 'PDF';
  if (/\bcbz\b/i.test(name)) return 'CBZ';
  if (/\bcbr\b/i.test(name)) return 'CBR';
  return files && files > 1 ? 'Pack' : '?';
}

/** "Saga #12 (2024)" → 12; "Batman 015 (2017) (Digital)" → 15; "#1 – 4" → 4. */
export function issueOf(title: string): number | undefined {
  const t = decodeHtml(title).replace(/\.(cbz|cbr|zip|pdf)$/i, '');
  // Collected volumes / TPBs aren't issues.
  if (/\b(vol(ume)?\.?|tpb|t)\s*\d+\b/i.test(t) && !/#\s?\d/.test(t)) return undefined;
  const range = t.match(/#\s?\d+(?:\.\d+)?\s*[-–]\s*#?\s?(\d+(?:\.\d+)?)/);
  if (range) return Number(range[1]);
  const hash = t.match(/#\s?(\d+(?:\.\d+)?)/);
  if (hash) return Number(hash[1]);
  const num = t.match(/\s(\d{2,4})(?:\.\d)?\s*(?:\(|\.cb[zr]|$)/i);
  if (num && !/^(19|20)\d\d$/.test(num[1])) return Number(num[1]);
  return undefined;
}

/** "Saga #12 (2024)" → "saga": the series part, for matching follows. */
export function seriesKey(title: string) {
  return decodeHtml(title)
    .replace(/\.(cbz|cbr|zip|pdf)$/i, '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/#\s?\d.*$/, ' ')
    .replace(/\s\d{2,4}(\.\d)?\s*(\.cb[zr])?\s*$/i, ' ')
    .replace(/\b(vol(ume)?|tpb|omnibus|annual)\b.*$/i, ' ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

// --- Search -------------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

type WpPost = {
  id: number;
  link: string;
  date?: string;
  title: { rendered: string };
  jetpack_featured_media_url?: string;
};

export async function searchGetComics(query: string, page = 1): Promise<ComicRelease[]> {
  const { getcomics } = await getComicSites();
  const posts = await fetchJson<WpPost[]>(
    `${getcomics}/wp-json/wp/v2/posts?search=${encodeURIComponent(query)}&per_page=30&page=${page}&_fields=id,link,date,title,jetpack_featured_media_url`,
  );
  return posts.map((p) => {
    const title = decodeHtml(p.title.rendered);
    return {
      id: `gc:${p.id}`,
      source: 'getcomics',
      title,
      link: p.link,
      cover: p.jetpack_featured_media_url || undefined,
      date: p.date,
      format: 'Direct',
      issue: issueOf(title),
    };
  });
}

type TpbRow = {
  id: string;
  name: string;
  info_hash: string;
  seeders: string;
  size: string;
  num_files: string;
  added: string;
};

export async function searchTpb(query: string): Promise<ComicRelease[]> {
  const { tpb } = await getComicSites();
  const rows = await fetchJson<TpbRow[]>(`${tpb}/q.php?q=${encodeURIComponent(query)}&cat=602`);
  return rows
    .filter((r) => r.info_hash && !/^0+$/.test(r.info_hash) && r.id !== '0')
    .map((r) => ({
      id: `tpb:${r.info_hash.toLowerCase()}`,
      source: 'tpb',
      title: r.name,
      infoHash: r.info_hash,
      seeders: Number(r.seeders) || 0,
      size: Number(r.size) || undefined,
      files: Number(r.num_files) || undefined,
      date: r.added ? new Date(Number(r.added) * 1000).toISOString() : undefined,
      format: formatOf(r.name, Number(r.num_files)),
      issue: issueOf(r.name),
    }));
}

const FORMAT_RANK: Record<ComicFormat, number> = { CBZ: 0, Direct: 1, '?': 2, Pack: 3, PDF: 4, CBR: 9 };

/** Both sites at once: CBZ first, CBR last; then newest GetComics posts / best-seeded torrents. */
export async function searchComicReleases(query: string) {
  const [gc, tpb] = await Promise.allSettled([searchGetComics(query), searchTpb(query)]);
  const errors = [gc, tpb]
    .map((r, i) => (r.status === 'rejected' ? `${i ? 'Pirate Bay' : 'GetComics'}: ${String(r.reason?.message ?? r.reason)}` : null))
    .filter(Boolean) as string[];
  const all = [
    ...(gc.status === 'fulfilled' ? gc.value : []),
    ...(tpb.status === 'fulfilled' ? tpb.value : []),
  ];
  all.sort(
    (a, b) =>
      FORMAT_RANK[a.format] - FORMAT_RANK[b.format] || (b.seeders ?? 0) - (a.seeders ?? 0),
  );
  return { results: all, errors };
}

// --- Wanted comics --------------------------------------------------------------------

export type WantedComic = {
  id: string;
  title: string;
  release: ComicRelease;
  state: 'queued' | 'torbox' | 'downloading' | 'done' | 'error';
  progress: number;
  error?: string;
  torboxId?: number;
  /** The series on the phone once it's imported. */
  seriesId?: string;
  addedAt: number;
};

let wantedCache: WantedComic[] | null = null;
const wantedListeners = new Set<(l: WantedComic[]) => void>();

export async function getComicWanted(): Promise<WantedComic[]> {
  if (!wantedCache) {
    try {
      wantedCache = JSON.parse((await AsyncStorage.getItem(WANTED_KEY)) ?? '[]') as WantedComic[];
    } catch {
      wantedCache = [];
    }
    // Downloads cut off when the app closed start again.
    wantedCache = wantedCache.map((w) =>
      w.state === 'downloading' ? { ...w, state: w.torboxId ? 'torbox' : 'queued' } : w,
    );
  }
  return wantedCache;
}

export function onComicWanted(fn: (l: WantedComic[]) => void) {
  wantedListeners.add(fn);
  return () => {
    wantedListeners.delete(fn);
  };
}

async function saveWanted(list: WantedComic[]) {
  wantedCache = list;
  wantedListeners.forEach((l) => l(list));
  await AsyncStorage.setItem(WANTED_KEY, JSON.stringify(list));
}

async function patchWanted(id: string, patch: Partial<WantedComic>) {
  await saveWanted((await getComicWanted()).map((w) => (w.id === id ? { ...w, ...patch } : w)));
}

export async function removeComicWanted(id: string) {
  await saveWanted((await getComicWanted()).filter((w) => w.id !== id));
}

/** Tap a result: it goes on the Wanted list and starts coming to the phone. */
export async function grabComic(release: ComicRelease): Promise<WantedComic> {
  if (release.format === 'CBR') throw new Error('That one is a CBR (RAR) file, which 128bit can’t open. Pick a CBZ.');
  const list = await getComicWanted();
  const existing = list.find((w) => w.id === release.id);
  if (existing && existing.state !== 'error') return existing;
  const entry: WantedComic = {
    id: release.id,
    title: release.title,
    release,
    state: 'queued',
    progress: 0,
    addedAt: Date.now(),
  };
  await saveWanted([entry, ...list.filter((w) => w.id !== release.id)]);
  runComicQueue().catch(() => {});
  return entry;
}

export async function retryComic(id: string) {
  const w = (await getComicWanted()).find((x) => x.id === id);
  if (!w) return;
  await patchWanted(id, { state: w.torboxId ? 'torbox' : 'queued', error: undefined, progress: 0 });
  runComicQueue().catch(() => {});
}

/** The direct file link behind a GetComics post's "Download Now" button. */
async function getComicsFileLink(post: string) {
  const res = await fetch(post, { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) 128bit' } });
  if (!res.ok) throw new Error(`GetComics answered ${res.status}`);
  const html = await res.text();
  const buttons = [...html.matchAll(/<a\b[^>]*>/gi)].map((m) => m[0]);
  const href = (tag: string) => tag.match(/href="([^"]+)"/i)?.[1];
  const title = (tag: string) => tag.match(/title="([^"]+)"/i)?.[1] ?? '';
  // "DOWNLOAD NOW" is GetComics' own server; then PixelDrain (also /dls/), then any direct .cbz.
  const main =
    buttons.find((t) => /download now/i.test(title(t))) ??
    buttons.find((t) => /\/dls\//.test(href(t) ?? '') && !/pixeldrain/i.test(title(t))) ??
    buttons.find((t) => /\/dls\//.test(href(t) ?? '')) ??
    buttons.find((t) => /\.cbz(\?|$)/i.test(href(t) ?? ''));
  const link = main && href(main);
  if (!link) throw new Error('No download link on that GetComics page (it may only have host mirrors).');
  return decodeHtml(link);
}

const comicFile = (name: string) => /\.(cbz|zip|cbr|pdf)$/i.test(name);

async function downloadToPhone(url: string, name: string) {
  const dir = new Directory(Paths.cache, 'comic-grab');
  dir.create({ intermediates: true, idempotent: true });
  const safe = name.replace(/[^\w.()\[\] -]+/g, '_').slice(-120) || 'comic.cbz';
  const target = new File(dir, safe);
  if (target.exists) target.delete();
  return File.downloadFileAsync(url, target, { idempotent: true });
}

function checkOpenable(names: string[]) {
  const ok = names.filter((n) => /\.(cbz|zip)$/i.test(n));
  if (ok.length) return;
  if (names.some((n) => /\.cbr$/i.test(n))) throw new Error('This is CBR (RAR), which 128bit can’t open. Pick a CBZ release.');
  if (names.some((n) => /\.pdf$/i.test(n))) throw new Error('This is a PDF comic; 128bit reads CBZ only.');
  throw new Error('No CBZ files in it.');
}

let queueRunning = false;

/** Moves every wanted comic along: download, TorBox, import. Safe to call often. */
export async function runComicQueue() {
  if (queueRunning || Platform.OS === 'web') return;
  queueRunning = true;
  try {
    for (const w of await getComicWanted()) {
      if (w.state === 'done' || w.state === 'error') continue;
      try {
        await step(w);
      } catch (e) {
        await patchWanted(w.id, { state: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    }
  } finally {
    queueRunning = false;
  }
}

async function step(w: WantedComic) {
  const r = w.release;
  if (r.source === 'getcomics') {
    await patchWanted(w.id, { state: 'downloading', progress: 0 });
    const url = await getComicsFileLink(r.link!);
    const nameFromUrl = decodeURIComponent(url.split('?')[0].split('/').pop() ?? '');
    const file = await downloadToPhone(url, comicFile(nameFromUrl) ? nameFromUrl : `${r.title}.cbz`);
    try {
      // Check what actually arrived: CBZ is a zip ("PK"); CBR is RAR; PDF is PDF.
      const data = await file.bytes();
      const head = String.fromCharCode(...data.subarray(0, 4));
      if (head.startsWith('Rar!')) checkOpenable(['x.cbr']);
      if (head.startsWith('%PDF')) checkOpenable(['x.pdf']);
      if (!head.startsWith('PK')) throw new Error('GetComics didn’t send a comic file (try again later).');
      const series = await importCbzFiles(
        [{ name: file.name, bytes: async () => data }],
        r.title.replace(/\s*\(\d{4}\)\s*$/, ''),
      );
      await addCover(series.comic.id, r);
      await patchWanted(w.id, { state: 'done', progress: 1, seriesId: series.comic.id });
    } finally {
      if (file.exists) file.delete();
    }
    return;
  }

  // The Pirate Bay → TorBox → phone.
  let torboxId = w.torboxId;
  if (!torboxId) {
    torboxId = (await addMagnet(magnetFromHash(r.infoHash!, r.title), r.title)).id;
    await patchWanted(w.id, { state: 'torbox', torboxId });
  }
  const item = await getItem('torrent', torboxId);
  if (!item.download_finished) {
    await patchWanted(w.id, { state: 'torbox', progress: item.progress ?? 0 });
    return; // Next run checks again.
  }
  const files = item.files.filter((f: TorboxFile) => comicFile(f.short_name ?? f.name));
  checkOpenable(files.map((f) => f.short_name ?? f.name));
  const cbz = files.filter((f) => /\.(cbz|zip)$/i.test(f.short_name ?? f.name));
  await patchWanted(w.id, { state: 'downloading', progress: 0 });
  const local: File[] = [];
  try {
    for (const [i, f] of cbz.entries()) {
      const link = await requestLink('torrent', torboxId, f.id);
      local.push(await downloadToPhone(link, f.short_name ?? f.name.split('/').pop() ?? `${i}.cbz`));
      await patchWanted(w.id, { progress: (i + 1) / cbz.length });
    }
    const series = await importCbzFiles(local, cbz.length > 1 ? cleanPackName(r.title) : undefined);
    await addCover(series.comic.id, r);
    await patchWanted(w.id, { state: 'done', progress: 1, seriesId: series.comic.id });
  } finally {
    local.forEach((f) => f.exists && f.delete());
  }
}

/**
 * The comic's proper cover: GetComics' cover art for the post, or (for torrents) the
 * cover of the closest GetComics match. Otherwise the first page stays the cover.
 */
async function addCover(seriesId: string, r: ComicRelease) {
  try {
    let cover = r.cover;
    if (!cover) {
      const q = cleanPackName(r.title).replace(/\b(digital|c2c|empire|dcp)\b.*$/i, '').trim();
      const hits = await searchGetComics(q);
      const key = seriesKey(r.title);
      cover = (hits.find((h) => h.issue === r.issue && seriesKey(h.title) === key) ??
        hits.find((h) => seriesKey(h.title) === key))?.cover;
    }
    if (cover) await setSeriesCover(seriesId, cover.replace(/\?.*$/, ''));
  } catch {
    // Keep the first page as the cover.
  }
}

const cleanPackName = (t: string) =>
  decodeHtml(t)
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\.(cbz|cbr|zip)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

// --- Follow a series: new issues ------------------------------------------------------

export type ComicFollow = {
  key: string;
  name: string;
  /** Highest issue you have (or were told about). */
  lastIssue: number;
  /** Grab new issues automatically. */
  auto: boolean;
  newIssues: ComicRelease[];
  checkedAt: number;
};

let followCache: ComicFollow[] | null = null;
const followListeners = new Set<(l: ComicFollow[]) => void>();

export async function getFollows(): Promise<ComicFollow[]> {
  if (!followCache) {
    try {
      followCache = JSON.parse((await AsyncStorage.getItem(FOLLOW_KEY)) ?? '[]') as ComicFollow[];
    } catch {
      followCache = [];
    }
  }
  return followCache;
}

export function onFollows(fn: (l: ComicFollow[]) => void) {
  followListeners.add(fn);
  return () => {
    followListeners.delete(fn);
  };
}

async function saveFollows(list: ComicFollow[]) {
  followCache = list;
  followListeners.forEach((l) => l(list));
  await AsyncStorage.setItem(FOLLOW_KEY, JSON.stringify(list));
}

/** Follow the series a release belongs to, starting after its issue. */
export async function followSeries(release: ComicRelease) {
  const key = seriesKey(release.title);
  if (!key) throw new Error('Couldn’t tell which series that is');
  const name = decodeHtml(release.title)
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/#\s?\d.*$/, '')
    .replace(/\s\d{2,4}(\.\d)?\s*(\.cb[zr])?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const list = await getFollows();
  const prev = list.find((f) => f.key === key);
  const follow: ComicFollow = {
    key,
    name: name || key,
    lastIssue: Math.max(prev?.lastIssue ?? 0, release.issue ?? 0),
    auto: prev?.auto ?? false,
    newIssues: prev?.newIssues ?? [],
    checkedAt: 0,
  };
  await saveFollows([follow, ...list.filter((f) => f.key !== key)]);
  return follow;
}

export async function unfollowSeries(key: string) {
  await saveFollows((await getFollows()).filter((f) => f.key !== key));
}

export async function setFollowAuto(key: string, auto: boolean) {
  await saveFollows((await getFollows()).map((f) => (f.key === key ? { ...f, auto } : f)));
}

/** "Got it": clears a new issue (it's been grabbed or you don't want it). */
export async function dismissNewIssue(key: string, releaseId: string) {
  await saveFollows(
    (await getFollows()).map((f) =>
      f.key === key ? { ...f, newIssues: f.newIssues.filter((r) => r.id !== releaseId) } : f,
    ),
  );
}

let followsRunning = false;

/** Looks for the next issues of everything you follow (every 6 hours, or now with `force`). */
export async function checkFollows(force = false) {
  if (followsRunning) return;
  followsRunning = true;
  try {
    for (const f of await getFollows()) {
      if (!force && Date.now() - f.checkedAt < FOLLOW_EVERY_MS) continue;
      const { results } = await searchComicReleases(f.name);
      const have = new Set((await getComicWanted()).map((w) => w.id));
      const fresh = results.filter(
        (r) =>
          seriesKey(r.title) === f.key &&
          r.issue !== undefined &&
          r.issue > f.lastIssue &&
          r.format !== 'CBR' &&
          !have.has(r.id) &&
          !f.newIssues.some((n) => n.id === r.id),
      );
      // One release per issue number: CBZ first (results are already in that order).
      const byIssue = new Map<number, ComicRelease>();
      for (const r of fresh) if (!byIssue.has(r.issue!)) byIssue.set(r.issue!, r);
      const found = [...byIssue.values()].sort((a, b) => a.issue! - b.issue!);
      if (f.auto) for (const r of found) await grabComic(r).catch(() => {});
      const top = Math.max(f.lastIssue, ...found.map((r) => r.issue!));
      await saveFollows(
        (await getFollows()).map((x) =>
          x.key === f.key
            ? {
                ...x,
                lastIssue: f.auto ? top : x.lastIssue,
                newIssues: f.auto ? x.newIssues : [...x.newIssues, ...found],
                checkedAt: Date.now(),
              }
            : x,
        ),
      );
    }
  } finally {
    followsRunning = false;
  }
}
