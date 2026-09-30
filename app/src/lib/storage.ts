import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { InstalledAddon, PlayableBook } from './types';

const KEYS = {
  addons: '128bit.addons',
  torboxKey: '128bit.torboxKey',
  progress: (bookKey: string) => `128bit.progress.${bookKey}`,
  recent: '128bit.recent',
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

export const getAddons = () => getJSON<InstalledAddon[]>(KEYS.addons, []);
export const saveAddons = (addons: InstalledAddon[]) => setJSON(KEYS.addons, addons);

// --- TorBox API key (SecureStore on device, AsyncStorage on web) -------------

export async function getTorboxKey(): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(KEYS.torboxKey);
  return SecureStore.getItemAsync(KEYS.torboxKey);
}

export async function setTorboxKey(key: string | null) {
  if (Platform.OS === 'web') {
    return key ? AsyncStorage.setItem(KEYS.torboxKey, key) : AsyncStorage.removeItem(KEYS.torboxKey);
  }
  return key
    ? SecureStore.setItemAsync(KEYS.torboxKey, key)
    : SecureStore.deleteItemAsync(KEYS.torboxKey);
}

// --- Listening progress -----------------------------------------------------

export type Progress = { chapter: number; position: number; updatedAt: number };

export const getProgress = (bookKey: string) =>
  getJSON<Progress | null>(KEYS.progress(bookKey), null);

export const saveProgress = (bookKey: string, progress: Omit<Progress, 'updatedAt'>) =>
  setJSON(KEYS.progress(bookKey), { ...progress, updatedAt: Date.now() });

// --- Continue listening -----------------------------------------------------

const MAX_RECENT = 20;

export const getRecent = () => getJSON<PlayableBook[]>(KEYS.recent, []);

export async function pushRecent(book: PlayableBook) {
  const recent = await getRecent();
  const next = [book, ...recent.filter((b) => b.key !== book.key)].slice(0, MAX_RECENT);
  await setJSON(KEYS.recent, next);
}
