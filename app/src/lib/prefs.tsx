/**
 * User preferences (theme, playback, tracking), saved on the device.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { lastSync, onAccount } from './account';

export const ACCENTS = {
  white: { name: 'White', color: '#FFFFFF', onAccent: '#000000' },
  crimson: { name: 'Crimson', color: '#E53935', onAccent: '#FFFFFF' },
  ocean: { name: 'Ocean', color: '#1E88E5', onAccent: '#FFFFFF' },
  violet: { name: 'Violet', color: '#8E24AA', onAccent: '#FFFFFF' },
  emerald: { name: 'Emerald', color: '#43A047', onAccent: '#FFFFFF' },
  amber: { name: 'Amber', color: '#FF8A2B', onAccent: '#FFFFFF' },
  rose: { name: 'Rose', color: '#D81B60', onAccent: '#FFFFFF' },
  teal: { name: 'Teal', color: '#00ACC1', onAccent: '#FFFFFF' },
  lime: { name: 'Lime', color: '#9CCC65', onAccent: '#000000' },
  gold: { name: 'Gold', color: '#FDD835', onAccent: '#000000' },
  indigo: { name: 'Indigo', color: '#5C6BC0', onAccent: '#FFFFFF' },
  coral: { name: 'Coral', color: '#FF7043', onAccent: '#FFFFFF' },
} as const;

/** A preset, or 'custom' (the colour in `customAccent`). */
export type AccentId = keyof typeof ACCENTS | 'custom';

export type Prefs = {
  accent: AccentId;
  /** "#RRGGBB", used when accent is 'custom'. */
  customAccent: string;
  amoled: boolean;
  /** Audiobook skip back / forward, in seconds. */
  skipBack: number;
  skipForward: number;
  defaultRate: number;
  autoNextChapter: boolean;
  /** Put newly released books of your series on Wanted (checked daily). */
  watchSeries: boolean;
  resumeVideos: boolean;
  /** Put streams TorBox already has cached at the top. */
  cachedFirst: boolean;
  traktScrobble: boolean;
  traktContinueWatching: boolean;
  /** Trakt rows on the Shows / Movies tabs, in order ("trending", "list:123", …). */
  traktRows: string[];
  /** 128bit Tracker rows (Up next, Watchlist, your lists) on the Shows / Movies / Anime tabs. */
  trackerRows: boolean;
  /** 3-letter code, e.g. "eng". */
  subtitleLanguage: string;
  autoSubtitles: boolean;
  subtitleSize: 'small' | 'medium' | 'large';
  autoPlayNextEpisode: boolean;
  /** Comics reader: scroll down (webtoon/manga), or page left-to-right / right-to-left. */
  readerMode: 'vertical' | 'ltr' | 'rtl';
  /** Smaller, compressed comic pages (saves data). */
  comicDataSaver: boolean;
  /** Comics tab: list extension sources in every language (otherwise English + multi-language). */
  comicAllLanguages: boolean;
  /** Delete a comic chapter's pages from the phone once you've read it (saves space). */
  comicDeleteRead: boolean;
  /** Every video: English audio track when there is one, and English subtitles always on. */
  englishFirst: boolean;
  /** Jump over openings and recaps by themselves (otherwise a Skip button shows). */
  autoSkipIntro: boolean;
  /** Torrents: TorBox when there's a key, else this device ('auto'); or always one of them. */
  torrentMode: 'auto' | 'device' | 'torbox';
  /** Device torrents only download on Wi-Fi / only with a VPN on. */
  torrentWifiOnly: boolean;
  torrentVpnOnly: boolean;
  /** Share back (seed) this many times the download before stopping; 0 = stop when done. */
  torrentSeedRatio: number;
};

export const DEFAULT_PREFS: Prefs = {
  accent: 'amber',
  customAccent: '#00E5FF',
  amoled: true,
  skipBack: 30,
  skipForward: 30,
  defaultRate: 1,
  autoNextChapter: true,
  watchSeries: true,
  resumeVideos: true,
  cachedFirst: true,
  traktScrobble: true,
  traktContinueWatching: true,
  traktRows: ['upnext', 'watchlist'],
  trackerRows: true,
  subtitleLanguage: 'eng',
  autoSubtitles: false,
  subtitleSize: 'medium',
  autoPlayNextEpisode: true,
  readerMode: 'vertical',
  comicDataSaver: false,
  comicAllLanguages: false,
  comicDeleteRead: false,
  englishFirst: true,
  autoSkipIntro: false,
  torrentMode: 'auto',
  torrentWifiOnly: false,
  torrentVpnOnly: false,
  torrentSeedRatio: 0,
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
    // Preferences synced in from your account (another device) take effect right away.
    return onAccount(() => {
      if (!lastSync()?.pulled.includes('prefs')) return;
      AsyncStorage.getItem(KEY)
        .then((raw) => raw && setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) }))
        .catch(() => {});
    });
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
