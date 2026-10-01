/**
 * Comics on the phone, no server needed:
 * - download chapters (MangaDex or your Suwayomi sources) to read offline;
 * - import CBZ files from the phone's storage (e.g. comic packs you got via TorBox).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { unzipSync } from 'fflate';
import { Platform } from 'react-native';

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
      .replace(/\.(cbz|zip)$/i, '')
      .replace(/[_.]+/g, ' ')
      .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
      // Cut at the volume / chapter / issue number: "v01", "Vol 105", "Chapter 97", "#12", "001".
      .replace(/(\s|^)(v\s?\d|vol\b|volume\b|ch\b|chapter\b|c\d|#\s?\d|\d{1,4}\s*$).*$/i, '')
      .replace(/[\s\-–—:,]+$/, '')
      .replace(/\s+/g, ' ')
      .trim() || fileName.replace(/\.(cbz|zip)$/i, '')
  );
}

/** A comic archive to import: a picked file or one downloaded by the app. */
type ArchiveFile = { name: string; bytes(): Promise<Uint8Array> };

/**
 * Pick one or more .cbz files: they become one series in your library (each file
 * a chapter/volume, in name order), with pages stored in the app.
 */
export async function importCbz(): Promise<LocalSeries | null> {
  if (!comicDownloadsSupported) throw new Error('Importing works in the phone app, not on the web.');
  const picked = await File.pickFileAsync({ multipleFiles: true, mimeTypes: ['*/*'] });
  if (picked.canceled) return null;
  return importCbzFiles(picked.result);
}

/**
 * Stores CBZ/ZIP archives as one series (each file a chapter/volume, in name order).
 * `title` names the series (otherwise taken from the first file name).
 */
export async function importCbzFiles(input: ArchiveFile[], title?: string): Promise<LocalSeries> {
  const files = [...input].sort((a, b) => natural(a.name, b.name));
  if (!files.length) throw new Error('Nothing to import');
  const rar = files.find((f) => /\.cbr$/i.test(f.name));
  if (rar) throw new Error(`${rar.name} is a CBR (RAR) file; only CBZ/ZIP can be imported.`);
  const id = `local:${Date.now().toString(36)}`;
  const chapters: LocalChapter[] = [];
  for (const [n, f] of files.entries()) {
    const entries = unzipSync(await f.bytes(), {
      filter: (e) => /\.(jpe?g|png|webp|gif|avif)$/i.test(e.name) && !/(^|\/)(__MACOSX|\.)/.test(e.name),
    });
    const names = Object.keys(entries).sort(natural);
    if (!names.length) throw new Error(`${f.name} has no pictures in it`);
    const chId = `${id}:${n + 1}`;
    const dir = dirFor(id, chId);
    dir.create({ intermediates: true, idempotent: true });
    const uris: string[] = [];
    let bytes = 0;
    names.forEach((name, i) => {
      const out = new File(dir, `${String(i + 1).padStart(4, '0')}.${name.split('.').pop()!.toLowerCase()}`);
      out.write(entries[name]);
      bytes += entries[name].byteLength;
      uris.push(out.uri);
    });
    chapters.push({
      id: chId,
      label: f.name.replace(/\.(cbz|zip)$/i, ''),
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
