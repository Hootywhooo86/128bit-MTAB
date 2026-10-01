/**
 * User preferences (theme, playback, tracking), saved on the device.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export const ACCENTS = {
  white: { name: 'White', color: '#FFFFFF', onAccent: '#000000' },
  crimson: { name: 'Crimson', color: '#E53935', onAccent: '#FFFFFF' },
  ocean: { name: 'Ocean', color: '#1E88E5', onAccent: '#FFFFFF' },
  violet: { name: 'Violet', color: '#8E24AA', onAccent: '#FFFFFF' },
  emerald: { name: 'Emerald', color: '#43A047', onAccent: '#FFFFFF' },
  amber: { name: 'Amber', color: '#FF8A2B', onAccent: '#FFFFFF' },
  rose: { name: 'Rose', color: '#D81B60', onAccent: '#FFFFFF' },
} as const;

export type AccentId = keyof typeof ACCENTS;

export type Prefs = {
  accent: AccentId;
  amoled: boolean;
  /** Audiobook skip back / forward, in seconds. */
  skipBack: number;
  skipForward: number;
  defaultRate: number;
  autoNextChapter: boolean;
  resumeVideos: boolean;
  /** Put streams TorBox already has cached at the top. */
  cachedFirst: boolean;
  traktScrobble: boolean;
  traktContinueWatching: boolean;
  /** 3-letter code, e.g. "eng". */
  subtitleLanguage: string;
  autoSubtitles: boolean;
  subtitleSize: 'small' | 'medium' | 'large';
  autoPlayNextEpisode: boolean;
  /** Keep video (sound) playing when the screen turns off or you leave the app. */
  backgroundVideo: boolean;
};

export const DEFAULT_PREFS: Prefs = {
  accent: 'amber',
  amoled: true,
  skipBack: 30,
  skipForward: 30,
  defaultRate: 1,
  autoNextChapter: true,
  resumeVideos: true,
  cachedFirst: true,
  traktScrobble: true,
  traktContinueWatching: true,
  subtitleLanguage: 'eng',
  autoSubtitles: false,
  subtitleSize: 'medium',
  autoPlayNextEpisode: true,
  backgroundVideo: true,
};

const KEY = '128bit.prefs';

type PrefsContextValue = {
  prefs: Prefs;
  loaded: boolean;
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
};

const PrefsContext = createContext<PrefsContextValue>({
  prefs: DEFAULT_PREFS,
  loaded: false,
  setPref: () => {},
});

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => raw && setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) }))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const setPref = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs((current) => {
      const next = { ...current, [key]: value };
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  return (
    <PrefsContext.Provider value={{ prefs, loaded, setPref }}>{children}</PrefsContext.Provider>
  );
}

export function usePrefs() {
  return useContext(PrefsContext);
}

/** For non-React code (e.g. the stream list sorter) that needs the saved value once. */
export async function readPrefs(): Promise<Prefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}
