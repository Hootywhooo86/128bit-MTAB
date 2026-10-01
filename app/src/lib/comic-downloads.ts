/**
 * Comics on the phone, no server needed:
 * - download chapters (MangaDex or your Suwayomi sources) to read offline;
 * - import CBZ files from the phone's storage (e.g. comic packs you got via TorBox).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { unzipSync } from 'fflate';
import { Platform } from 'react-native';

import { extractWithNative, sniffArchive } from './comic-archive';
import { comicImage, getPages, type Comic, type ComicChapter } from './comics';

const KEY = '128bit.comicDownloads';

export const comicDownloadsSupported = Platform.OS !== 'web';

export type LocalChapter = {
  id: string;
  label: string;
  /** Page image file URIs, in order. */
  files: string[];
  state: 'done' | 'downloading' | 'error';
  progress: number;
  error?: string;
  bytes?: number;
};

export type LocalSeries = { comic: Comic; chapters: LocalChapter[] };

let cache: LocalSeries[] | null = null;
const listeners = new Set<(list: LocalSeries[]) => void>();

export async function getComicDownloads(): Promise<LocalSeries[]> {
  if (!cache) {
    try {
      cache = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]') as LocalSeries[];
    } catch {
      cache = [];
    }
    // Interrupted downloads can be started again.
    cache = cache.map((s) => ({
      ...s,
      chapters: s.chapters.map((c) => (c.state === 'downloading' ? { ...c, state: 'error', error: 'Interrupted' } : c)),
    }));
  }
  return cache;
}

export function onComicDownloads(fn: (list: LocalSeries[]) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function save(list: LocalSeries[]) {
  cache = list;
  listeners.forEach((l) => l(list));
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}

async function upsertChapter(comic: Comic, chapter: LocalChapter) {
  const list = await getComicDownloads();
  const series = list.find((s) => s.comic.id === comic.id);
  const next = series
    ? list.map((s) =>
        s.comic.id === comic.id
          ? { ...s, chapters: [...s.chapters.filter((c) => c.id !== chapter.id), chapter] }
          : s,
      )
    : [{ comic, chapters: [chapter] }, ...list];
  await save(next);
}

/** The downloaded pages for a chapter, if it's on the phone. */
export async function localPages(chapterId: string): Promise<string[] | undefined> {
  for (const s of await getComicDownloads()) {
    const c = s.chapters.find((x) => x.id === chapterId && x.state === 'done');
    if (c) return c.files;
  }
  return undefined;
}

export async function getLocalSeries(comicId: string) {
  return (await getComicDownloads()).find((s) => s.comic.id === comicId);
}

const safe = (s: string) => s.replace(/[^a-z0-9._-]+/gi, '_');
const dirFor = (comicId: string, chapterId: string) =>
  new Directory(Paths.document, 'comics', safe(comicId), safe(chapterId));

let queue: Promise<unknown> = Promise.resolve();

/** Downloads chapters one after another (pages in order). */
export function downloadChapters(comic: Comic, chapters: ComicChapter[], label: (c: ComicChapter) => string) {
  if (!comicDownloadsSupported) throw new Error('Downloads work in the phone app, not on the web.');
  for (const ch of chapters) {
    upsertChapter(comic, { id: ch.id, label: label(ch), files: [], state: 'downloading', progress: 0 });
    queue = queue.then(() => downloadOne(comic, ch, label(ch))).catch(() => {});
  }
}

async function downloadOne(comic: Comic, ch: ComicChapter, label: string) {
  try {
    const urls = await getPages(ch.id, false, true);
    const dir = dirFor(comic.id, ch.id);
    dir.create({ intermediates: true, idempotent: true });
    const files: string[] = [];
    let bytes = 0;
    for (let i = 0; i < urls.length; i++) {
      const ext = urls[i].split('?')[0].match(/\.(jpe?g|png|webp|gif|avif)$/i)?.[1] ?? 'jpg';
      const file = new File(dir, `${String(i + 1).padStart(4, '0')}.${ext}`);
      if (!file.exists) {
        await File.downloadFileAsync(urls[i], file, { headers: comicImage(urls[i])?.headers, idempotent: true });
      }
      bytes += file.size ?? 0;
      files.push(file.uri);
      if (i % 3 === 0) await upsertChapter(comic, { id: ch.id, label, files: [], state: 'downloading', progress: (i + 1) / urls.length });
    }
    await upsertChapter(comic, { id: ch.id, label, files, state: 'done', progress: 1, bytes });
  } catch (e) {
    await upsertChapter(comic, { id: ch.id, label, files: [], state: 'error', progress: 0, error: e instanceof Error ? e.message : String(e) });
  }
}

export async function deleteChapter(comicId: string, chapterId: string) {
  try {
    const d = dirFor(comicId, chapterId);
    if (d.exists) d.delete();
  } catch {
    // Already gone.
  }
  const list = await getComicDownloads();
  await save(
    list
      .map((s) => (s.comic.id === comicId ? { ...s, chapters: s.chapters.filter((c) => c.id !== chapterId) } : s))
      .filter((s) => s.chapters.length),
  );
}

export async function deleteSeries(comicId: string) {
  try {
    const d = new Directory(Paths.document, 'comics', safe(comicId));
    if (d.exists) d.delete();
  } catch {
    // Already gone.
  }
  await save((await getComicDownloads()).filter((s) => s.comic.id !== comicId));
}

// --- CBZ import ------------------------------------------------------------------

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** "Berserk v01 (2003) (Digital).cbz" → "Berserk". */
function seriesName(fileName: string) {
  return (
    fileName
      .replace(/\.(cbz|zip|cbr|rar|cb7|7z|cbt|tar)$/i, '')
      .replace(/[_.]+/g, ' ')
      .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
      // Cut at the volume / chapter / issue number: "v01", "Vol 105", "Chapter 97", "#12", "001".
      .replace(/(\s|^)(v\s?\d|vol\b|volume\b|ch\b|chapter\b|c\d|#\s?\d|\d{1,4}\s*$).*$/i, '')
      .replace(/[\s\-–—:,]+$/, '')
      .replace(/\s+/g, ' ')
      .trim() || fileName.replace(/\.(cbz|zip|cbr|rar|cb7|7z|cbt|tar)$/i, '')
  );
}

/**
 * Pick one or more comic files (CBZ, and on Android also CBR/CB7): they become one
 * series in your library (each file a chapter/volume, in name order).
 */
export async function importCbz(): Promise<LocalSeries | null> {
  if (!comicDownloadsSupported) throw new Error('Importing works in the phone app, not on the web.');
  const picked = await File.pickFileAsync({ multipleFiles: true, mimeTypes: ['*/*'] });
  if (picked.canceled) return null;
  return importComicFiles(picked.result);
}

const ARCHIVE_NAME = /\.(cbz|zip|cbr|rar|cb7|7z|cbt|tar)$/i;

/** Pictures of one archive, in reading order, as files in `dir` named 0001.jpg… */
async function unpack(f: File, dir: Directory): Promise<{ uris: string[]; bytes: number }> {
  const handle = f.open();
  const head = handle.readBytes(8);
  handle.close();
  const kind = sniffArchive(head);
  if (kind === 'pdf') throw new Error(`${f.name} is a PDF; 128bitPlay reads CBZ and CBR comics.`);
  if (kind === 'unknown') throw new Error(`${f.name} isn’t a comic archive.`);
  dir.create({ intermediates: true, idempotent: true });
  const uris: string[] = [];
  let bytes = 0;
  if (extractWithNative) {
    // Picked files can be content:// links; the extractor needs a real file.
    let source = f;
    let temp: File | null = null;
    if (!f.uri.startsWith('file://')) {
      temp = new File(Paths.cache, `import-${Date.now()}`);
      f.copy(temp);
      source = temp;
    }
    try {
      const raw = new Directory(dir, 'raw');
      const found = await extractWithNative(source.uri, raw.uri);
      found.sort((a, b) => natural(a.name, b.name));
      found.forEach((e, i) => {
        const from = new File(e.uri);
        const to = new File(dir, `${String(i + 1).padStart(4, '0')}.${e.uri.split('.').pop()}`);
        bytes += from.size ?? 0;
        from.move(to);
        uris.push(to.uri);
      });
      if (raw.exists) raw.delete();
    } finally {
      if (temp?.exists) temp.delete();
    }
  } else {
    if (kind !== 'zip') throw new Error(`${f.name} is ${kind.toUpperCase()}; this version can only open CBZ.`);
    const entries = unzipSync(await f.bytes(), {
      filter: (e) => /\.(jpe?g|png|webp|gif|avif)$/i.test(e.name) && !/(^|\/)(__MACOSX|\.)/.test(e.name),
    });
    Object.keys(entries)
      .sort(natural)
      .forEach((name, i) => {
        const out = new File(dir, `${String(i + 1).padStart(4, '0')}.${name.split('.').pop()!.toLowerCase()}`);
        out.write(entries[name]);
        bytes += entries[name].byteLength;
        uris.push(out.uri);
      });
  }
  if (!uris.length) throw new Error(`${f.name} has no pictures in it`);
  return { uris, bytes };
}

/**
 * Stores comic archives (CBZ, CBR, CB7…) as one series (each file a chapter/volume,
 * in name order). `title` names the series (otherwise taken from the first file name).
 * `deleteSource` removes each archive once it's unpacked, to save space.
 */
export async function importComicFiles(input: File[], title?: string, deleteSource = false): Promise<LocalSeries> {
  const files = [...input].sort((a, b) => natural(a.name, b.name));
  if (!files.length) throw new Error('Nothing to import');
  const id = `local:${Date.now().toString(36)}`;
  const chapters: LocalChapter[] = [];
  for (const [n, f] of files.entries()) {
    const chId = `${id}:${n + 1}`;
    const { uris, bytes } = await unpack(f, dirFor(id, chId));
    if (deleteSource && f.exists) f.delete();
    chapters.push({
      id: chId,
      label: f.name.replace(ARCHIVE_NAME, ''),
      files: uris,
      state: 'done',
      progress: 1,
      bytes,
    });
  }
  const series: LocalSeries = {
    comic: { id, title: title || seriesName(files[0].name), cover: chapters[0].files[0] },
    chapters,
  };
  await save([series, ...(await getComicDownloads())]);
  return series;
}

/**
 * Frees space: deletes the pages of chapters you've finished (downloaded or imported).
 * Returns how many chapters were removed.
 */
export async function deleteReadChapters(readIds: (comicId: string) => string[]): Promise<number> {
  let removed = 0;
  for (const s of await getComicDownloads()) {
    const read = new Set(readIds(s.comic.id));
    for (const c of s.chapters) {
      if (c.state === 'done' && read.has(c.id)) {
        await deleteChapter(s.comic.id, c.id);
        removed++;
      }
    }
  }
  return removed;
}

/** Downloads a cover picture into the series' folder and uses it (works offline). */
export async function setSeriesCover(comicId: string, url: string) {
  const dir = new Directory(Paths.document, 'comics', safe(comicId));
  dir.create({ intermediates: true, idempotent: true });
  const ext = url.split('?')[0].match(/\.(jpe?g|png|webp)$/i)?.[1] ?? 'jpg';
  const file = new File(dir, `cover.${ext}`);
  if (file.exists) file.delete();
  const saved = await File.downloadFileAsync(url, file, { idempotent: true });
  const list = await getComicDownloads();
  await save(list.map((s) => (s.comic.id === comicId ? { ...s, comic: { ...s.comic, cover: saved.uri } } : s)));
}
