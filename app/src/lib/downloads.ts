/**
 * Saves audiobooks to the phone so they play offline.
 * Files live in <documents>/audiobooks/<book>/<chapter>.<ext>.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, DownloadTask, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { absFileUrl } from './audiobookshelf';
import { requestLink } from './torbox';
import type { Chapter, PlayableBook } from './types';

const INDEX_KEY = '128bit.downloads';

export const offlineSupported = Platform.OS !== 'web';

const safe = (s: string) => s.replace(/[^a-z0-9._-]+/gi, '_');

function bookDir(bookKey: string) {
  return new Directory(Paths.document, 'audiobooks', safe(bookKey));
}

function chapterFile(bookKey: string, chapter: Chapter) {
  const urlExt =
    chapter.ref.type === 'url'
      ? chapter.ref.url.split('?')[0].match(/\.(\w{2,4})$/)?.[1]
      : undefined;
  return new File(bookDir(bookKey), `${safe(chapter.id)}.${chapter.ext ?? urlExt ?? 'mp3'}`);
}

/** Local file URI if this chapter was downloaded, otherwise null. */
export function localChapterUri(bookKey: string, chapter: Chapter): string | null {
  if (!offlineSupported) return null;
  const file = chapterFile(bookKey, chapter);
  return file.exists ? file.uri : null;
}

/** A playable URL for the chapter: the local copy, a direct URL, or a fresh TorBox link. */
export async function chapterUrl(bookKey: string, chapter: Chapter): Promise<string> {
  const local = localChapterUri(bookKey, chapter);
  if (local) return local;
  if (chapter.ref.type === 'url') return chapter.ref.url;
  if (chapter.ref.type === 'abs') return absFileUrl(chapter.ref.path);
  return requestLink(chapter.ref.kind, chapter.ref.itemId, chapter.ref.fileId);
}

export async function getDownloadedBooks(): Promise<PlayableBook[]> {
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function setIndex(books: PlayableBook[]) {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(books));
}

// --- Live progress (the Downloads tab shows books while they download) -----------------

export type BookDownload = {
  /** 0..1 over the whole book. */
  fraction: number;
  bytes: number;
  /** Known when every chapter's size is (else the current chapter's). */
  total?: number;
  /** Bytes per second. */
  speed: number;
  chapter: number;
  chapters: number;
};

const live = new Map<string, BookDownload>();
const tasks = new Map<string, DownloadTask>();
const running = new Map<string, Promise<void>>();
const liveListeners = new Set<() => void>();

/** Books downloading right now, by key. */
export const bookDownloads = () => new Map(live);

export function onBookDownloads(fn: () => void) {
  liveListeners.add(fn);
  return () => {
    liveListeners.delete(fn);
  };
}
const emit = () => liveListeners.forEach((l) => l());

/** Downloads a book's chapters (skipping ones already here). Calling again while it runs joins it. */
export function downloadBook(
  book: PlayableBook,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const already = running.get(book.key);
  if (already) return already;
  const job = runDownload(book, onProgress).finally(() => {
    running.delete(book.key);
    live.delete(book.key);
    tasks.delete(book.key);
    emit();
  });
  running.set(book.key, job);
  return job;
}

async function runDownload(book: PlayableBook, onProgress?: (done: number, total: number) => void) {
  if (!offlineSupported) throw new Error('Offline downloads are only available on iOS and Android');
  bookDir(book.key).create({ intermediates: true, idempotent: true });
  const books = await getDownloadedBooks();
  await setIndex([book, ...books.filter((b) => b.key !== book.key)]);

  const n = book.chapters.length;
  const sizes = book.chapters.map((c) => c.size ?? 0);
  const allSized = sizes.every((s) => s > 0);
  const total = allSized ? sizes.reduce((a, b) => a + b, 0) : undefined;
  let before = 0; // bytes of the chapters already done
  let last = { at: Date.now(), bytes: 0 };
  let speed = 0;
  const report = (i: number, current: number, currentTotal: number) => {
    const now = Date.now();
    const bytes = before + current;
    if (now - last.at >= 1000) {
      const s = ((bytes - last.bytes) * 1000) / (now - last.at);
      speed = speed ? speed * 0.6 + s * 0.4 : s;
      last = { at: now, bytes };
    }
    const fraction = total
      ? bytes / total
      : (i + (currentTotal > 0 ? current / currentTotal : 0)) / Math.max(1, n);
    live.set(book.key, {
      fraction: Math.min(1, fraction),
      bytes,
      total: total ?? (n === 1 && currentTotal > 0 ? currentTotal : undefined),
      speed,
      chapter: i,
      chapters: n,
    });
    emit();
  };

  for (let i = 0; i < n; i++) {
    const chapter = book.chapters[i];
    onProgress?.(i, n);
    const file = chapterFile(book.key, chapter);
    if (file.exists) {
      before += file.size ?? sizes[i];
      report(i + 1 === n ? i : i + 1, 0, 0);
      continue;
    }
    report(i, 0, 0);
    const url = await chapterUrl(book.key, chapter);
    const partial = new File(bookDir(book.key), `${file.name}.part`);
    if (partial.exists) partial.delete();
    const task = new DownloadTask(url, partial, {
      onProgress: ({ bytesWritten, totalBytes }) => report(i, bytesWritten, totalBytes),
    });
    tasks.set(book.key, task);
    const done = await task.downloadAsync();
    if (!done) throw new Error('Download cancelled');
    // Only a whole chapter counts as downloaded.
    partial.move(file);
    before += file.size ?? sizes[i];
  }
  onProgress?.(n, n);
}

/** ✕ on a download: stop it and remove what came down. */
export async function cancelBookDownload(bookKey: string) {
  tasks.get(bookKey)?.cancel();
  await running.get(bookKey)?.catch(() => {});
  await deleteDownload(bookKey);
}

export async function deleteDownload(bookKey: string) {
  if (offlineSupported) {
    const dir = bookDir(bookKey);
    if (dir.exists) dir.delete();
  }
  const books = await getDownloadedBooks();
  await setIndex(books.filter((b) => b.key !== bookKey));
}

export function isBookDownloaded(book: PlayableBook) {
  return book.chapters.every((c) => localChapterUri(book.key, c));
}

/** Bytes this book takes up on the phone. */
export function downloadedBytes(book: PlayableBook) {
  if (!offlineSupported) return 0;
  return book.chapters.reduce((sum, c) => {
    const file = chapterFile(book.key, c);
    return sum + (file.exists ? (file.size ?? 0) : 0);
  }, 0);
}

/** Reads byte ranges from a downloaded chapter (for reading .m4b chapter markers offline). */
export function localRangeReader(bookKey: string, chapter: Chapter) {
  return async (start: number, end: number) => {
    const handle = chapterFile(bookKey, chapter).open();
    try {
      handle.offset = start;
      const size = handle.size ?? 0;
      return handle.readBytes(Math.max(0, Math.min(end + 1, size) - start));
    } finally {
      handle.close();
    }
  };
}

/** Saves an updated copy of a downloaded book (e.g. once its chapter markers are known). */
export async function updateDownloadedBook(book: PlayableBook) {
  const books = await getDownloadedBooks();
  if (books.some((b) => b.key === book.key)) {
    await setIndex(books.map((b) => (b.key === book.key ? book : b)));
  }
}
