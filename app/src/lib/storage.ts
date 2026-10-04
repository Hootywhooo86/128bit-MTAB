import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { InstalledAddon, PlayableBook } from './types';

const KEYS = {
  addons: '128bit.addons',
  torboxKey: '128bit.torboxKey',
  progress: (bookKey: string) => `128bit.progress.${bookKey}`,
  library: '128bit.library',
  favorites: '128bit.favorites',
};

async function getJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function setJSON(key: string, value: unknown) {
  return AsyncStorage.setItem(key, JSON.stringify(value));
}

// --- Addons -----------------------------------------------------------------

/** Every installed addon, in the user's order. */
export const getAddons = () => getJSON<InstalledAddon[]>(KEYS.addons, []);

const addonListeners = new Set<() => void>();

/** Called whenever the addon list changes (e.g. defaults installed on first launch). */
export function onAddonsChanged(listener: () => void) {
  addonListeners.add(listener);
  return () => {
    addonListeners.delete(listener);
  };
}

export async function saveAddons(addons: InstalledAddon[]) {
  await setJSON(KEYS.addons, addons);
  notifyAddonsChanged();
}

/** The addon list changed underneath (e.g. synced from your account). */
export const notifyAddonsChanged = () => addonListeners.forEach((l) => l());

export const isEnabled = (a: InstalledAddon) => a.enabled !== false;

/** Only the addons that are switched on. Use this everywhere content is fetched. */
export const getActiveAddons = async () => (await getAddons()).filter(isEnabled);

// --- Secrets (SecureStore on device, AsyncStorage on web) -------------------

export async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

let secureListener: ((key: string) => void) | null = null;

/** Account sync watches secret changes (TorBox key, sign-ins) so they reach your other devices. */
export function onSecureChange(fn: (key: string) => void) {
  secureListener = fn;
}

export async function secureSet(key: string, value: string | null) {
  secureListener?.(key);
  if (Platform.OS === 'web') {
    return value ? AsyncStorage.setItem(key, value) : AsyncStorage.removeItem(key);
  }
  return value ? SecureStore.setItemAsync(key, value) : SecureStore.deleteItemAsync(key);
}

export const getTorboxKey = () => secureGet(KEYS.torboxKey);
export const setTorboxKey = (key: string | null) => secureSet(KEYS.torboxKey, key);

// --- Listening progress -----------------------------------------------------

export type Progress = {
  chapter: number;
  position: number;
  /** 0..1 through the whole book. */
  fraction: number;
  finished: boolean;
  updatedAt: number;
};

export const getProgress = (bookKey: string) =>
  getJSON<Progress | null>(KEYS.progress(bookKey), null);

export const saveProgress = (bookKey: string, progress: Omit<Progress, 'updatedAt'>) =>
  setJSON(KEYS.progress(bookKey), { ...progress, updatedAt: Date.now() });

export async function getProgressMany(bookKeys: string[]): Promise<Record<string, Progress>> {
  const pairs = await AsyncStorage.multiGet(bookKeys.map(KEYS.progress));
  const out: Record<string, Progress> = {};
  pairs.forEach(([, raw], i) => {
    if (raw) out[bookKeys[i]] = JSON.parse(raw);
  });
  return out;
}

/**
 * How far through the book we are. Chapters are weighted by file size when every
 * chapter has one, otherwise equally.
 */
export function bookFraction(
  book: PlayableBook,
  chapter: number,
  position: number,
  duration: number,
) {
  // Exact when every file's length is known (e.g. Audiobookshelf).
  if (book.chapters.every((c) => c.seconds)) {
    const total = book.chapters.reduce((sum, c) => sum + c.seconds!, 0);
    const before = book.chapters.slice(0, chapter).reduce((sum, c) => sum + c.seconds!, 0);
    return Math.min(1, (before + position) / total);
  }
  const weights = book.chapters.every((c) => c.size)
    ? book.chapters.map((c) => c.size!)
    : book.chapters.map(() => 1);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const before = weights.slice(0, chapter).reduce((a, b) => a + b, 0);
  const within = duration > 0 ? Math.min(1, position / duration) : 0;
  return Math.min(1, (before + (weights[chapter] ?? 0) * within) / total);
}

// --- Audiobook library ------------------------------------------------------

/** Books you've started or added, most recently played first. */
export const getLibrary = () => getJSON<PlayableBook[]>(KEYS.library, []);

export async function addToLibrary(book: PlayableBook) {
  const books = await getLibrary();
  await setJSON(KEYS.library, [book, ...books.filter((b) => b.key !== book.key)]);
}

export async function removeFromLibrary(bookKey: string) {
  const books = await getLibrary();
  await setJSON(
    KEYS.library,
    books.filter((b) => b.key !== bookKey),
  );
}

export const getFavorites = () => getJSON<string[]>(KEYS.favorites, []);

export async function toggleFavorite(bookKey: string): Promise<string[]> {
  const favs = await getFavorites();
  const next = favs.includes(bookKey) ? favs.filter((k) => k !== bookKey) : [...favs, bookKey];
  await setJSON(KEYS.favorites, next);
  return next;
}
