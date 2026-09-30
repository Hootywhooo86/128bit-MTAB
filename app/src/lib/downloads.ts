/**
 * Saves audiobooks to the phone so they play offline.
 * Files live in <documents>/audiobooks/<book>/<chapter>.<ext>.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
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

export async function downloadBook(
  book: PlayableBook,
  onProgress?: (done: number, total: number) => void,
) {
  if (!offlineSupported) throw new Error('Offline downloads are only available on iOS and Android');
  bookDir(book.key).create({ intermediates: true, idempotent: true });
  const books = await getDownloadedBooks();
  await setIndex([book, ...books.filter((b) => b.key !== book.key)]);

  for (let i = 0; i < book.chapters.length; i++) {
    const chapter = book.chapters[i];
    onProgress?.(i, book.chapters.length);
    const file = chapterFile(book.key, chapter);
    if (file.exists) continue;
    const url = await chapterUrl(book.key, chapter);
    await File.downloadFileAsync(url, file, { idempotent: true });
  }
  onProgress?.(book.chapters.length, book.chapters.length);
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
