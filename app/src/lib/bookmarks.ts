/**
 * Bookmarks inside audiobooks: a chapter, a position and an optional note.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Bookmark = {
  id: string;
  chapter: number;
  position: number;
  /** What the chapter (or in-file chapter) was called when you saved it. */
  label: string;
  note?: string;
  createdAt: number;
};

const key = (bookKey: string) => `128bit.bookmarks.${bookKey}`;

export async function getBookmarks(bookKey: string): Promise<Bookmark[]> {
  try {
    const raw = await AsyncStorage.getItem(key(bookKey));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function save(bookKey: string, list: Bookmark[]) {
  await AsyncStorage.setItem(key(bookKey), JSON.stringify(list));
  return list;
}

export async function addBookmark(bookKey: string, b: Omit<Bookmark, 'id' | 'createdAt'>) {
  const list = await getBookmarks(bookKey);
  const entry: Bookmark = { ...b, id: `${Date.now()}`, createdAt: Date.now() };
  // Keep them in listening order.
  return save(
    bookKey,
    [...list, entry].sort((x, y) => x.chapter - y.chapter || x.position - y.position),
  );
}

export async function removeBookmark(bookKey: string, id: string) {
  return save(
    bookKey,
    (await getBookmarks(bookKey)).filter((b) => b.id !== id),
  );
}
