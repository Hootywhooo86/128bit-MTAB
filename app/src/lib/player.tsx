/**
 * One app-wide audiobook player, so playback keeps going while you browse.
 *
 * A book is a list of files ("chapters"). A single file can also hold its own
 * chapter markers (an .m4b); those are found in the background the first time
 * the file plays, and next/previous then jump between them.
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

import { absReportProgress, absResumePoint, isAbsBook } from './audiobookshelf';
import { hardcoverProgress } from './hardcover';
import { addBookmark as storeBookmark } from './bookmarks';
import { chapterUrl, localChapterUri, localRangeReader, updateDownloadedBook } from './downloads';
import { httpRangeReader, readMp4Chapters } from './mp4-chapters';
import { usePrefs } from './prefs';
import { addToLibrary, bookFraction, getProgress, saveProgress } from './storage';
import type { Chapter, PlayableBook } from './types';

const SAVE_EVERY_MS = 10_000;
/** Pressing "previous" this far into a chapter restarts it instead of going back. */
const RESTART_THRESHOLD_S = 3;
const MP4_AUDIO = /^(m4b|m4a|mp4|aac)$/i;

export type Sleep = { kind: 'minutes'; at: number; minutes: number } | { kind: 'chapter' } | null;

export type Mark = { title: string; start: number; index: number };

type PlayerContextValue = {
  book: PlayableBook | null;
  chapterIndex: number;
  /** The in-file chapter being played, when the file has markers. */
  mark: Mark | null;
  playing: boolean;
  loading: boolean;
  error: string | null;
  position: number;
  duration: number;
  rate: number;
  sleep: Sleep;
  playBook: (book: PlayableBook, chapter?: number) => Promise<void>;
  playChapter: (index: number) => Promise<void>;
  jumpTo: (chapter: number, position: number) => Promise<void>;
  next: () => void;
  previous: () => void;
  hasNext: boolean;
  hasPrevious: boolean;
  toggle: () => void;
  seekTo: (seconds: number) => void;
  seekBy: (seconds: number) => void;
  setRate: (rate: number) => void;
  setSleep: (sleep: Sleep) => void;
  addBookmark: (note?: string) => Promise<void>;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside <PlayerProvider>');
  return ctx;
}

function currentMark(chapter: Chapter | undefined, position: number): Mark | null {
  const marks = chapter?.marks;
  if (!marks?.length) return null;
  let index = 0;
  for (let i = 0; i < marks.length; i++) if (marks[i].start <= position + 0.25) index = i;
  return { ...marks[index], index };
}

function looksLikeMp4(chapter: Chapter) {
  if (chapter.ext) return MP4_AUDIO.test(chapter.ext);
  if (chapter.ref.type === 'url') return /\.(m4b|m4a|mp4)(\?|$)/i.test(chapter.ref.url);
  return false;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const player = useAudioPlayer(null, { updateInterval: 500 });
  const status = useAudioPlayerStatus(player);

  const [book, setBook] = useState<PlayableBook | null>(null);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { prefs } = usePrefs();
  const [rate, setRateState] = useState(prefs.defaultRate);
  const [sleep, setSleep] = useState<Sleep>(null);

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

  /** Looks for chapter markers inside an .m4b-style file once, and remembers them. */
  const detectMarks = useCallback(async (target: PlayableBook, index: number, uri: string) => {
    const chapter = target.chapters[index];
    if (!chapter || chapter.marksChecked || !looksLikeMp4(chapter)) return;
    let marks: Chapter['marks'] = [];
    try {
      const reader = localChapterUri(target.key, chapter)
        ? localRangeReader(target.key, chapter)
        : httpRangeReader(uri);
      marks = await readMp4Chapters(reader);
    } catch {
      // No markers (or the server can't do ranges): carry on without them.
    }
    const updated: PlayableBook = {
      ...target,
      chapters: target.chapters.map((c, i) =>
        i === index ? { ...c, marks: marks.length > 1 ? marks : undefined, marksChecked: true } : c,
      ),
    };
    setBook((current) => (current?.key === updated.key ? updated : current));
    addToLibrary(updated);
    updateDownloadedBook(updated);
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
          fraction: bookFraction(target, index, startAt, 0),
          finished: false,
        });
        detectMarks(target, index, uri);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [player, rate, detectMarks],
  );

  const playBook = useCallback(
    async (next: PlayableBook, chapter?: number) => {
      setBook(next);
      addToLibrary(next);
      if (chapter !== undefined) return loadChapter(next, chapter);
      const saved = await getProgress(next.key);
      let index = saved && saved.chapter < next.chapters.length ? saved.chapter : 0;
      let position = saved?.position ?? 0;
      // Audiobookshelf keeps its own position (e.g. from its web player); use it if newer.
      if (isAbsBook(next)) {
        const remote = await absResumePoint(next).catch(() => null);
        if (remote && (!saved || remote.updatedAt > saved.updatedAt)) {
          index = remote.chapter;
          position = remote.position;
        }
      }
      return loadChapter(next, index, position);
    },
    [loadChapter],
  );

  const playChapter = useCallback(
    async (index: number) => {
      if (book) await loadChapter(book, index);
    },
    [book, loadChapter],
  );

  const jumpTo = useCallback(
    async (index: number, position: number) => {
      if (!book) return;
      if (index === chapterIndex && status.isLoaded) {
        player.seekTo(position);
        if (!status.playing) player.play();
      } else {
        await loadChapter(book, index, position);
      }
    },
    [book, chapterIndex, loadChapter, player, status.isLoaded, status.playing],
  );

  // Resume where we left off once the new chapter has loaded.
  useEffect(() => {
    if (status.isLoaded && pendingSeek.current !== null) {
      const to = pendingSeek.current;
      pendingSeek.current = null;
      player.seekTo(to);
    }
  }, [status.isLoaded, player]);

  const chapter = book?.chapters[chapterIndex];
  const mark = currentMark(chapter, status.currentTime);

  // Keep the lock screen title on the in-file chapter.
  const markTitle = mark?.title;
  useEffect(() => {
    if (!book || !markTitle) return;
    player.updateLockScreenMetadata({
      title: markTitle,
      artist: book.author,
      albumTitle: book.title,
      artworkUrl: book.cover,
    });
  }, [markTitle, book, player]);

  // Sleep at the end of an in-file chapter: pause as soon as the next marker starts.
  const markIndex = mark?.index;
  const sleepMarkRef = useRef<number | null>(null);
  useEffect(() => {
    if (sleep?.kind !== 'chapter') {
      sleepMarkRef.current = null;
      return;
    }
    if (markIndex === undefined) return;
    if (sleepMarkRef.current === null) sleepMarkRef.current = markIndex;
    else if (markIndex !== sleepMarkRef.current) {
      player.pause();
      setSleep(null);
    }
  }, [sleep, markIndex, player]);

  // A file ended: stop for the sleep timer, go to the next one, or finish the book.
  const onFinish = useRef(() => {});
  useEffect(() => {
    onFinish.current = () => {
      if (!book) return;
      if (sleep?.kind === 'chapter') {
        setSleep(null);
        return;
      }
      if (chapterIndex + 1 < book.chapters.length) {
        if (!prefs.autoNextChapter) return;
        loadChapter(book, chapterIndex + 1);
      } else {
        finished.current = true;
        saveProgress(book.key, { chapter: 0, position: 0, fraction: 1, finished: true });
        if (isAbsBook(book)) absReportProgress(book, chapterIndex, status.duration, true);
        hardcoverProgress(book, 1, true);
      }
    };
  }, [book, chapterIndex, loadChapter, prefs.autoNextChapter, sleep, status.duration]);

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
      const fraction = bookFraction(book, chapterIndex, status.currentTime, status.duration);
      saveProgress(book.key, {
        chapter: chapterIndex,
        position: status.currentTime,
        fraction,
        finished: false,
      });
      if (isAbsBook(book)) absReportProgress(book, chapterIndex, status.currentTime, false);
      hardcoverProgress(book, fraction, false);
    }
  }, [book, chapterIndex, status.currentTime, status.duration, status.playing, status.isLoaded]);

  // Sleep after N minutes.
  useEffect(() => {
    if (sleep?.kind !== 'minutes') return;
    const id = setTimeout(
      () => {
        player.pause();
        setSleep(null);
      },
      Math.max(0, sleep.at - Date.now()),
    );
    return () => clearTimeout(id);
  }, [sleep, player]);

  const marks = chapter?.marks ?? [];
  const hasNext =
    !!book &&
    ((!!mark && mark.index + 1 < marks.length) || chapterIndex + 1 < book.chapters.length);
  const hasPrevious = !!book;

  const next = () => {
    if (!book) return;
    if (mark && mark.index + 1 < marks.length) player.seekTo(marks[mark.index + 1].start);
    else if (chapterIndex + 1 < book.chapters.length) loadChapter(book, chapterIndex + 1);
  };

  // Like a CD player: restart the current chapter, or go back one if you're at its start.
  const previous = () => {
    if (!book) return;
    const chapterStart = mark?.start ?? 0;
    if (status.currentTime - chapterStart > RESTART_THRESHOLD_S) player.seekTo(chapterStart);
    else if (mark && mark.index > 0) player.seekTo(marks[mark.index - 1].start);
    else if (chapterIndex > 0) loadChapter(book, chapterIndex - 1);
    else player.seekTo(0);
  };

  const value: PlayerContextValue = {
    book,
    chapterIndex,
    mark,
    playing: status.playing,
    loading: loading || (status.isBuffering && !status.playing),
    error: error ?? status.error ?? null,
    position: status.currentTime,
    duration: status.duration,
    rate,
    sleep,
    playBook,
    playChapter,
    jumpTo,
    next,
    previous,
    hasNext,
    hasPrevious,
    toggle: () => (status.playing ? player.pause() : player.play()),
    seekTo: (s) => player.seekTo(Math.max(0, s)),
    seekBy: (s) =>
      player.seekTo(Math.min(Math.max(0, status.currentTime + s), status.duration || Infinity)),
    setRate: (r) => {
      setRateState(r);
      player.setPlaybackRate(r);
    },
    setSleep,
    addBookmark: async (note?: string) => {
      if (!book) return;
      await storeBookmark(book.key, {
        chapter: chapterIndex,
        position: status.currentTime,
        label: mark?.title ?? chapter?.title ?? `Chapter ${chapterIndex + 1}`,
        note: note?.trim() || undefined,
      });
    },
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
