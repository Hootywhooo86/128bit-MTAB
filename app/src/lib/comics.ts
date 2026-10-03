/**
 * Comics and manga from MangaDex (api.mangadex.org): browse, search, chapters and
 * pages, plus your comics library and reading progress on the phone.
 *
 * MangaDex is free and open, but licensed series are often taken down there, so
 * some titles show up with few or no chapters.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { deleteReadChapters, getLocalSeries, localPages } from './comic-downloads';
import { readPrefs } from './prefs';
import {
  browseSource,
  getChapterPages,
  getManga,
  getMangaChapters,
  markChapter,
  setInLibrary,
  suwayomiImageHeaders,
  suwayomiNow,
  suwayomiUrl,
  type SuwaManga,
} from './suwayomi';
import {
  WEBTOON_HEADERS,
  getWebtoon,
  getWebtoonEpisodes,
  getWebtoonPages,
  isWebtoon,
  isWebtoonImage,
} from './webtoons';

const API = 'https://api.mangadex.org';
const COVERS = 'https://uploads.mangadex.org/covers';
const LIBRARY_KEY = '128bit.comics.library';
const PROGRESS_KEY = '128bit.comics.progress';
const LANG = 'en';
const RATINGS = 'contentRating[]=safe&contentRating[]=suggestive';

export type Comic = {
  id: string;
  title: string;
  cover?: string;
  author?: string;
  description?: string;
  status?: string;
  year?: number;
  tags?: string[];
  lastChapter?: string;
};

export type ComicChapter = {
  id: string;
  number?: string;
  volume?: string;
  title?: string;
  pages: number;
  group?: string;
  publishedAt?: string;
  /** Hosted elsewhere (e.g. the official publisher); opens in the browser. */
  externalUrl?: string;
  /** Shown as-is instead of "Ch. N · title" (Suwayomi chapter names already say it). */
  label?: string;
};

export type ReadProgress = {
  chapterId: string;
  chapterLabel: string;
  page: number;
  pages: number;
  /** How far down that page you were (0..1), for the scrolling reader. */
  offset?: number;
  /** Chapter ids you've finished. */
  read: string[];
  updatedAt: number;
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Accept: 'application/json' } });
  const body = (await res.json().catch(() => null)) as
    | (T & { result?: string; errors?: { detail?: string }[] })
    | null;
  if (!res.ok || !body || body.result === 'error') {
    throw new Error(body?.errors?.[0]?.detail ?? `MangaDex answered ${res.status}`);
  }
  return body;
}

type Rel = { id: string; type: string; attributes?: Record<string, any> };
type RawManga = { id: string; attributes: Record<string, any>; relationships: Rel[] };

const pickLang = (m?: Record<string, string>) =>
  m ? (m.en ?? m['ja-ro'] ?? m['ko-ro'] ?? m['zh-ro'] ?? Object.values(m)[0]) : undefined;

function toComic(m: RawManga): Comic {
  const a = m.attributes;
  const cover = m.relationships.find((r) => r.type === 'cover_art')?.attributes?.fileName;
  const altEn = (a.altTitles as Record<string, string>[] | undefined)?.find((t) => t.en)?.en;
  return {
    id: m.id,
    title: a.title?.en ?? altEn ?? pickLang(a.title) ?? 'Untitled',
    cover: cover ? `${COVERS}/${m.id}/${cover}.512.jpg` : undefined,
    author: m.relationships
      .filter((r) => r.type === 'author' && r.attributes?.name)
      .map((r) => r.attributes!.name)
      .join(', ') || undefined,
    description: pickLang(a.description)?.replace(/\[[^\]]+\]\([^)]+\)|---[\s\S]*$/g, '').trim(),
    status: a.status,
    year: a.year ?? undefined,
    tags: (a.tags as { attributes: { name: Record<string, string> } }[] | undefined)
      ?.map((t) => pickLang(t.attributes.name))
      .filter(Boolean) as string[],
    lastChapter: a.lastChapter || undefined,
  };
}

const LIST = `includes[]=cover_art&includes[]=author&${RATINGS}&hasAvailableChapters=true&availableTranslatedLanguage[]=${LANG}`;

export type ComicList = 'popular' | 'latest' | 'top';

export async function listComics(kind: ComicList, offset = 0, limit = 24): Promise<Comic[]> {
  const order = {
    popular: 'order[followedCount]=desc',
    latest: 'order[latestUploadedChapter]=desc',
    top: 'order[rating]=desc',
  }[kind];
  const data = await get<{ data: RawManga[] }>(
    `/manga?limit=${limit}&offset=${offset}&${order}&${LIST}`,
  );
  return data.data.map(toComic);
}

export async function searchComics(query: string): Promise<Comic[]> {
  const data = await get<{ data: RawManga[] }>(
    `/manga?limit=30&title=${encodeURIComponent(query)}&order[relevance]=desc&includes[]=cover_art&includes[]=author&${RATINGS}`,
  );
  return data.data.map(toComic);
}

// --- Suwayomi (Mihon extensions) ---------------------------------------------------
// Comics from Suwayomi have ids starting with "sw:"; everything else is MangaDex.

const isSw = (id: string) => id.startsWith('sw:');
/** Imported from the phone (CBZ). */
const isLocal = (id: string) => id.startsWith('local:');
const swId = (id: string) => Number(id.slice(3));

export function comicFromSuwayomi(m: SuwaManga): Comic {
  return {
    id: `sw:${m.id}`,
    title: m.title,
    cover: suwayomiUrl(m.thumbnailUrl),
    author: [m.author, m.artist].filter((x, i, a) => x && a.indexOf(x) === i).join(', ') || undefined,
    description: m.description ?? undefined,
    status: m.status && m.status !== 'UNKNOWN' ? m.status.toLowerCase().replace(/_/g, ' ') : undefined,
    tags: m.genre,
  };
}

/** Popular / latest / search results from one of your Suwayomi sources. */
export async function browseSuwayomi(
  sourceId: string,
  kind: 'POPULAR' | 'LATEST' | 'SEARCH',
  page = 1,
  query?: string,
) {
  const r = await browseSource(sourceId, kind, page, query);
  return { comics: r.mangas.map(comicFromSuwayomi), hasNextPage: r.hasNextPage };
}

/** Image source for expo-image: adds Suwayomi's sign-in headers for its covers and pages. */
export function comicImage(uri?: string) {
  if (!uri) return undefined;
  const sw = suwayomiNow();
  if (sw && uri.startsWith(sw.url)) return { uri, headers: suwayomiImageHeaders() };
  if (isWebtoonImage(uri)) return { uri, headers: WEBTOON_HEADERS };
  return { uri };
}

export async function getComic(id: string): Promise<Comic> {
  if (isLocal(id)) {
    const s = await getLocalSeries(id);
    if (!s) throw new Error('This comic is no longer on the phone');
    return s.comic;
  }
  if (isSw(id)) return comicFromSuwayomi(await getManga(swId(id)));
  if (isWebtoon(id)) return getWebtoon(id);
  const data = await get<{ data: RawManga }>(
    `/manga/${id}?includes[]=cover_art&includes[]=author`,
  );
  return toComic(data.data);
}

type RawChapter = { id: string; attributes: Record<string, any>; relationships: Rel[] };

/** English chapters in reading order, one upload per chapter number. */
export async function getChapters(id: string): Promise<ComicChapter[]> {
  if (isLocal(id)) {
    const s = await getLocalSeries(id);
    return (s?.chapters ?? []).map((c) => ({ id: c.id, label: c.label, pages: c.files.length }));
  }
  if (isWebtoon(id)) return getWebtoonEpisodes(id);
  if (isSw(id)) {
    return (await getMangaChapters(swId(id))).map((c) => ({
      id: `sw:${c.id}`,
      number: c.chapterNumber >= 0 ? String(c.chapterNumber) : undefined,
      label: c.name,
      // The page count is only known once a chapter has been opened.
      pages: c.pageCount > 0 ? c.pageCount : 1,
      group: c.scanlator ?? undefined,
      publishedAt: c.uploadDate ? new Date(Number(c.uploadDate)).toISOString() : undefined,
    }));
  }
  const all: RawChapter[] = [];
  for (let offset = 0; offset < 5000; offset += 500) {
    const page = await get<{ data: RawChapter[]; total: number }>(
      `/manga/${id}/feed?translatedLanguage[]=${LANG}&order[volume]=asc&order[chapter]=asc&limit=500&offset=${offset}&includes[]=scanlation_group&${RATINGS}&contentRating[]=erotica`,
    );
    all.push(...page.data);
    if (offset + 500 >= page.total) break;
  }
  const seen = new Set<string>();
  return all
    .map<ComicChapter>((c) => ({
      id: c.id,
      number: c.attributes.chapter ?? undefined,
      volume: c.attributes.volume ?? undefined,
      title: c.attributes.title || undefined,
      pages: c.attributes.pages ?? 0,
      group: c.relationships.find((r) => r.type === 'scanlation_group')?.attributes?.name,
      publishedAt: c.attributes.publishAt,
      externalUrl: c.attributes.externalUrl ?? undefined,
    }))
    .filter((c) => c.pages > 0 || c.externalUrl)
    .filter((c) => {
      const key = c.number ?? c.id; // oneshots have no number
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export const chapterLabel = (c: Pick<ComicChapter, 'number' | 'volume' | 'title' | 'label'>) =>
  c.label ?? [c.number ? `Ch. ${c.number}` : 'Oneshot', c.title].filter(Boolean).join(' · ');

/** Image URLs for a chapter's pages. `saver` uses MangaDex's smaller, compressed images. */
export async function getPages(chapterId: string, saver: boolean, remoteOnly = false): Promise<string[]> {
  // Downloaded or imported: read from the phone.
  if (!remoteOnly) {
    const local = await localPages(chapterId);
    if (local) return local;
  }
  if (isSw(chapterId)) return getChapterPages(swId(chapterId));
  if (isWebtoon(chapterId)) return getWebtoonPages(chapterId);
  const d = await get<{
    baseUrl: string;
    chapter: { hash: string; data: string[]; dataSaver: string[] };
  }>(`/at-home/server/${chapterId}`);
  const files = saver ? d.chapter.dataSaver : d.chapter.data;
  return files.map((f) => `${d.baseUrl}/${saver ? 'data-saver' : 'data'}/${d.chapter.hash}/${f}`);
}

// --- Library & progress -------------------------------------------------------

async function read<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const getComicLibrary = () => read<Comic[]>(LIBRARY_KEY, []);

export async function inComicLibrary(id: string) {
  return (await getComicLibrary()).some((c) => c.id === id);
}

export async function toggleComicLibrary(comic: Comic): Promise<boolean> {
  const list = await getComicLibrary();
  const has = list.some((c) => c.id === comic.id);
  if (isSw(comic.id)) setInLibrary(swId(comic.id), !has).catch(() => {});
  await AsyncStorage.setItem(
    LIBRARY_KEY,
    JSON.stringify(has ? list.filter((c) => c.id !== comic.id) : [comic, ...list]),
  );
  return !has;
}

export const getAllComicProgress = () => read<Record<string, ReadProgress>>(PROGRESS_KEY, {});

export async function getComicProgress(id: string): Promise<ReadProgress | undefined> {
  return (await getAllComicProgress())[id];
}

/** Saves where you are; `finished` marks the chapter read. */
export async function saveComicProgress(
  comic: Comic,
  chapter: ComicChapter,
  page: number,
  pages: number,
  finished: boolean,
  offset = 0,
) {
  const all = await getAllComicProgress();
  const prev = all[comic.id];
  const readIds = new Set(prev?.read ?? []);
  if (finished) readIds.add(chapter.id);
  all[comic.id] = {
    chapterId: chapter.id,
    chapterLabel: chapterLabel(chapter),
    page,
    pages,
    offset: Math.max(0, Math.min(1, offset)),
    read: [...readIds],
    updatedAt: Date.now(),
  };
  await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  if (isSw(chapter.id)) markChapter(swId(chapter.id), page, finished).catch(() => {});
  // "Delete after reading": earlier finished chapters leave the phone (not the one on screen).
  if (finished && (await readPrefs()).comicDeleteRead) {
    const done = [...readIds].filter((id) => id !== chapter.id);
    deleteReadChapters((id) => (id === comic.id ? done : [])).catch(() => {});
  }
  // Reading something puts it in your library.
  if (!(await inComicLibrary(comic.id))) await toggleComicLibrary(comic);
}

export async function setChapterRead(comicId: string, chapterId: string, isRead: boolean) {
  const all = await getAllComicProgress();
  const p = all[comicId];
  if (!p) return;
  const ids = new Set(p.read);
  if (isRead) ids.add(chapterId);
  else ids.delete(chapterId);
  all[comicId] = { ...p, read: [...ids] };
  await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
}
