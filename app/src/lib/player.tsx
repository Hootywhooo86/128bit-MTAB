/**
 * One app-wide audiobook player, so playback keeps going while you browse.
 */
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { chapterUrl } from './downloads';
import { addToLibrary, bookFraction, getProgress, saveProgress } from './storage';
import type { PlayableBook } from './types';

const SAVE_EVERY_MS = 10_000;

type PlayerContextValue = {
  book: PlayableBook | null;
  chapterIndex: number;
  playing: boolean;
  loading: boolean;
  error: string | null;
  position: number;
  duration: number;
  rate: number;
  sleepAt: number | null;
  playBook: (book: PlayableBook, chapter?: number) => Promise<void>;
  playChapter: (index: number) => Promise<void>;
  toggle: () => void;
  seekTo: (seconds: number) => void;
  seekBy: (seconds: number) => void;
  setRate: (rate: number) => void;
  setSleepTimer: (minutes: number | null) => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside <PlayerProvider>');
  return ctx;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const player = useAudioPlayer(null, { updateInterval: 500 });
  const status = useAudioPlayerStatus(player);

  const [book, setBook] = useState<PlayableBook | null>(null);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rate, setRateState] = useState(1);
  const [sleepAt, setSleepAt] = useState<number | null>(null);

  const pendingSeek = useRef<number | null>(null);
  const lastSave = useRef(0);
  const finished = useRef(false);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => {});
  }, []);

  const loadChapter = useCallback(
    async (target: PlayableBook, index: number, startAt = 0) => {
      const chapter = target.chapters[index];
      if (!chapter) return;
      setLoading(true);
      setError(null);
      setChapterIndex(index);
      try {
        const uri = await chapterUrl(target.key, chapter);
        pendingSeek.current = startAt > 0 ? startAt : null;
        player.replace({ uri });
        player.setPlaybackRate(rate);
        player.play();
        player.setActiveForLockScreen(
          true,
          {
            title: chapter.title,
            artist: target.author,
            albumTitle: target.title,
            artworkUrl: target.cover,
          },
          { showSeekForward: true, showSeekBackward: true },
        );
        finished.current = false;
        saveProgress(target.key, {
          chapter: index,
          position: startAt,
          fraction: bookFraction(target, index, 0, 0),
          finished: false,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [player, rate],
  );

  const playBook = useCallback(
    async (next: PlayableBook, chapter?: number) => {
      setBook(next);
      addToLibrary(next);
      if (chapter !== undefined) return loadChapter(next, chapter);
      const saved = await getProgress(next.key);
      const index = saved && saved.chapter < next.chapters.length ? saved.chapter : 0;
      return loadChapter(next, index, saved?.position ?? 0);
    },
    [loadChapter],
  );

  const playChapter = useCallback(
    async (index: number) => {
      if (book) await loadChapter(book, index);
    },
    [book, loadChapter],
  );

  // Resume where we left off once the new chapter has loaded.
  useEffect(() => {
    if (status.isLoaded && pendingSeek.current !== null) {
      const to = pendingSeek.current;
      pendingSeek.current = null;
      player.seekTo(to);
    }
  }, [status.isLoaded, player]);

  // Auto-advance to the next chapter. Refs keep the listener stable across renders.
  const onFinish = useRef(() => {});
  useEffect(() => {
    onFinish.current = () => {
      if (!book) return;
      if (chapterIndex + 1 < book.chapters.length) {
        loadChapter(book, chapterIndex + 1);
      } else {
        finished.current = true;
        saveProgress(book.key, { chapter: 0, position: 0, fraction: 1, finished: true });
      }
    };
  }, [book, chapterIndex, loadChapter]);

  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (s) => {
      if (s.didJustFinish) onFinish.current();
    });
    return () => sub.remove();
  }, [player]);

  // Save progress regularly while playing.
  useEffect(() => {
    if (!book || !status.isLoaded || finished.current) return;
    const now = Date.now();
    if (!status.playing || now - lastSave.current > SAVE_EVERY_MS) {
      lastSave.current = now;
      saveProgress(book.key, {
        chapter: chapterIndex,
        position: status.currentTime,
        fraction: bookFraction(book, chapterIndex, status.currentTime, status.duration),
        finished: false,
      });
    }
  }, [book, chapterIndex, status.currentTime, status.duration, status.playing, status.isLoaded]);

  // Sleep timer.
  useEffect(() => {
    if (!sleepAt) return;
    const id = setTimeout(() => {
      player.pause();
      setSleepAt(null);
    }, Math.max(0, sleepAt - Date.now()));
    return () => clearTimeout(id);
  }, [sleepAt, player]);

  const value: PlayerContextValue = {
    book,
    chapterIndex,
    playing: status.playing,
    loading: loading || (status.isBuffering && !status.playing),
    error: error ?? status.error ?? null,
    position: status.currentTime,
    duration: status.duration,
    rate,
    sleepAt,
    playBook,
    playChapter,
    toggle: () => (status.playing ? player.pause() : player.play()),
    seekTo: (s) => player.seekTo(Math.max(0, s)),
    seekBy: (s) =>
      player.seekTo(Math.min(Math.max(0, status.currentTime + s), status.duration || Infinity)),
    setRate: (r) => {
      setRateState(r);
      player.setPlaybackRate(r);
    },
    setSleepTimer: (minutes) => setSleepAt(minutes ? Date.now() + minutes * 60_000 : null),
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
