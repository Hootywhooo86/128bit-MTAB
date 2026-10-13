/**
 * One app-wide audiobook player, so playback keeps going while you browse — and
 * when you close the app.
 *
 * Android tears the app's screens down when you swipe it away, so the player and
 * everything that keeps a book going (next chapter, saving your place, the sleep
 * timer, the lock-screen buttons) live here at module level, outside any screen.
 * The lock-screen controls keep the app alive; reopening it picks the same player
 * back up. React only reads this state (PlayerProvider / usePlayer).
 *
 * A book is a list of files ("chapters"). A single file can also hold its own
 * chapter markers (an .m4b); those are found in the background the first time
 * the file plays, and next/previous then jump between them.
 */
import {
  createAudioPlayer,
  setAudioModeAsync,
  useAudioPlayerStatus,
  type AudioMetadata,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import { Asset } from 'expo-asset';
import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { absReportProgress, absResumePoint, isAbsBook } from './audiobookshelf';
import { findCover } from './covers';
import { hardcoverProgress } from './hardcover';
import { reportBookProgress } from './tracker-live';
import { sessionEnd, sessionTick } from './sessions';
import { addListening, markBookFinished } from './stats';
import { addBookmark as storeBookmark } from './bookmarks';
import { chapterUrl, localChapterUri, localRangeReader, updateDownloadedBook } from './downloads';
import { httpRangeReader, readMp4Chapters } from './mp4-chapters';
import { usePrefs } from './prefs';
import { addToLibrary, bookFraction, getProgress, saveProgress } from './storage';
import { askBackgroundPlaybackOnce } from './torrent-device';
import type { Chapter, PlayableBook } from './types';

const SAVE_EVERY_MS = 10_000;
/** Pressing "previous" this far into a chapter restarts it instead of going back. */
const RESTART_THRESHOLD_S = 3;
const MP4_AUDIO = /^(m4b|m4a|mp4|aac)$/i;

export type Sleep = { kind: 'minutes'; at: number; minutes: number } | { kind: 'chapter' } | null;

export type Mark = { title: string; start: number; index: number };

/** Pixel-art artwork for the lock screen when a book has no cover. */
let fallbackArt: string | undefined;
Asset.fromModule(require('../../assets/images/pixel-cover.png'))
  .downloadAsync()
  .then((a) => {
    fallbackArt = a.localUri ?? a.uri;
  })
  .catch(() => {});

/** What the lock screen / notification shows: the chapter, book, author and cover. */
function lockScreenInfo(book: PlayableBook, chapterIndex: number, mark: Mark | null): AudioMetadata {
  const chapter = book.chapters[chapterIndex];
  const marks = chapter?.marks;
  const count = marks?.length ? marks.length : book.chapters.length;
  const n = marks?.length && mark ? mark.index + 1 : chapterIndex + 1;
  const name = mark?.title ?? chapter?.title ?? `Chapter ${n}`;
  return {
    title: name,
    artist: [book.author, `Ch. ${n} of ${count}`].filter(Boolean).join(' · '),
    albumTitle: book.title,
    artworkUrl: book.cover ?? fallbackArt,
  };
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

// --- The engine (module level: survives the app's screens closing) --------------

type EngineState = {
  book: PlayableBook | null;
  chapterIndex: number;
  loading: boolean;
  error: string | null;
  rate: number;
  sleep: Sleep;
};

let state: EngineState = {
  book: null,
  chapterIndex: 0,
  loading: false,
  error: null,
  rate: 1,
  sleep: null,
};
const listeners = new Set<() => void>();

function update(patch: Partial<EngineState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const snapshot = () => state;

/** Settings the engine needs, copied in from preferences by PlayerProvider. */
const options = { autoNextChapter: true, rateSet: false };

let pendingSeek: number | null = null;
let lastSave = 0;
let finished = false;
let lastTick = 0;
let listenedSeconds = 0;
let lastLockKey = '';
let sleepMark: number | null = null;
let lockScreenOn = false;
let sleepTimer: ReturnType<typeof setTimeout> | null = null;

let audio: AudioPlayer | null = null;

/**
 * Loudness of 16 frequency bands of the book, ~20×/s (Android; see the expo-audio patch).
 * Sampling runs only while someone is listening for it.
 */
export function onAudioLevels(f: (levels: number[]) => void) {
  const a = getAudio();
  try {
    a.setAudioSamplingEnabled(true);
  } catch {
    return () => {};
  }
  const sub = a.addListener('audioSampleUpdate', (s) => f(s.channels[0]?.frames ?? []));
  return () => {
    sub.remove();
    try {
      a.setAudioSamplingEnabled(false);
    } catch {
      // released
    }
  };
}

function getAudio(): AudioPlayer {
  if (audio) return audio;
  audio = createAudioPlayer(null, { updateInterval: 500 });
  setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'doNotMix',
  }).catch(() => {});
  audio.addListener('playbackStatusUpdate', onStatus);
  // Previous / next chapter buttons on the lock screen and notification.
  type Remote = { addListener(e: 'remoteChapter', fn: (dir: string) => void): { remove(): void } };
  (audio as unknown as Remote).addListener('remoteChapter', (dir) =>
    dir === 'next' ? next() : previous(),
  );
  return audio;
}

/** Everything that has to keep happening while a book plays, screen or no screen. */
function onStatus(s: AudioStatus) {
  const p = getAudio();
  const { book, chapterIndex } = state;
  // Resume where we left off once the new chapter has loaded.
  if (s.isLoaded && pendingSeek !== null) {
    const to = pendingSeek;
    pendingSeek = null;
    p.seekTo(to);
  }
  if (!book) return;
  if (s.didJustFinish) {
    onFinish();
    return;
  }
  const chapter = book.chapters[chapterIndex];
  const mark = currentMark(chapter, s.currentTime);

  // Keep the lock screen on the current chapter (in-file chapters included).
  const lockKey = `${book.key}|${chapterIndex}|${mark?.index ?? -1}|${book.cover ?? ''}`;
  if (lockKey !== lastLockKey) {
    lastLockKey = lockKey;
    p.updateLockScreenMetadata(lockScreenInfo(book, chapterIndex, mark));
  }

  // Sleep at the end of an in-file chapter: pause as soon as the next marker starts.
  if (state.sleep?.kind === 'chapter' && mark) {
    if (sleepMark === null) sleepMark = mark.index;
    else if (mark.index !== sleepMark) {
      p.pause();
      setSleep(null);
    }
  }

  // Save progress regularly while playing, and when paused.
  const now = Date.now();
  if (s.isLoaded && !finished && (!s.playing || now - lastSave > SAVE_EVERY_MS)) {
    lastSave = now;
    const fraction = bookFraction(book, chapterIndex, s.currentTime, s.duration);
    saveProgress(book.key, {
      chapter: chapterIndex,
      position: s.currentTime,
      fraction,
      finished: false,
    });
    if (isAbsBook(book)) absReportProgress(book, chapterIndex, s.currentTime, false);
    // Every few minutes while listening, and right away when you pause.
    hardcoverProgress(book, fraction, false, !s.playing);
    reportBookProgress(book, fraction, false, !s.playing);
  }

  // Statistics: listening time, counted while playing.
  if (s.playing) {
    if (lastTick) listenedSeconds += Math.min(5, (now - lastTick) / 1000);
    lastTick = now;
    if (listenedSeconds >= 10) {
      sessionTick(book.key, 'listen.session', { title: book.title, author: book.author, poster: book.cover }, {
        seconds: listenedSeconds,
        pct: bookFraction(book, chapterIndex, s.currentTime, s.duration) * 100,
        pos: s.currentTime,
        ch: chapterIndex,
      });
      addListening(book, Math.round(listenedSeconds));
      listenedSeconds = 0;
    }
  } else {
    lastTick = 0;
  }
}

/** A file ended: stop for the sleep timer, go to the next one, or finish the book. */
function onFinish() {
  const { book, chapterIndex } = state;
  if (!book) return;
  if (state.sleep?.kind === 'chapter') {
    setSleep(null);
    return;
  }
  if (chapterIndex + 1 < book.chapters.length) {
    if (options.autoNextChapter) loadChapter(book, chapterIndex + 1);
    return;
  }
  finished = true;
  saveProgress(book.key, { chapter: 0, position: 0, fraction: 1, finished: true });
  if (isAbsBook(book)) absReportProgress(book, chapterIndex, getAudio().duration, true);
  hardcoverProgress(book, 1, true);
  reportBookProgress(book, 1, true);
  sessionTick(book.key, 'listen.session', { title: book.title, author: book.author, poster: book.cover }, { finished: true });
  sessionEnd(book.key);
  markBookFinished(book);
}

/** Looks for chapter markers inside an .m4b-style file once, and remembers them. */
async function detectMarks(target: PlayableBook, index: number, uri: string) {
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
  if (state.book?.key === updated.key) update({ book: updated });
  addToLibrary(updated);
  updateDownloadedBook(updated);
}

async function loadChapter(target: PlayableBook, index: number, startAt = 0, autoPlay = true) {
  const chapter = target.chapters[index];
  if (!chapter) return;
  const p = getAudio();
  update({ loading: true, error: null, chapterIndex: index });
  try {
    const uri = await chapterUrl(target.key, chapter);
    pendingSeek = startAt > 0 ? startAt : null;
    p.replace({ uri });
    p.setPlaybackRate(state.rate);
    // Opening a book from the library just shows where you are; it plays when you tap Play.
    if (autoPlay) p.play();
    lastLockKey = '';
    // Set up the lock screen / notification once. Doing it again (new book or chapter) makes
    // expo-audio rebuild its media session without staying a foreground service, and Android
    // then stops the app in the background a few minutes later. After that, only update it.
    if (!lockScreenOn) {
      lockScreenOn = true;
      p.setActiveForLockScreen(true, lockScreenInfo(target, index, null), {
        showSeekForward: true,
        showSeekBackward: true,
      });
    } else {
      p.updateLockScreenMetadata(lockScreenInfo(target, index, null));
    }
    finished = false;
    saveProgress(target.key, {
      chapter: index,
      position: startAt,
      fraction: bookFraction(target, index, startAt, 0),
      finished: false,
    });
    detectMarks(target, index, uri);
  } catch (e) {
    update({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    update({ loading: false });
  }
}

async function playBook(nextBook: PlayableBook, chapter?: number, autoPlay = true) {
  if (autoPlay) askBackgroundPlaybackOnce().catch(() => {});
  // No cover (e.g. a TorBox download)? Find one, for the app and the lock screen.
  if (!nextBook.cover) {
    const cover = await Promise.race([
      findCover(nextBook.title, nextBook.author),
      new Promise<undefined>((r) => setTimeout(r, 3000)),
    ]);
    if (cover) nextBook = { ...nextBook, cover };
  }
  update({ book: nextBook });
  addToLibrary(nextBook);
  if (chapter !== undefined) return loadChapter(nextBook, chapter, 0, autoPlay);
  const saved = await getProgress(nextBook.key);
  let index = saved && saved.chapter < nextBook.chapters.length ? saved.chapter : 0;
  let position = saved?.position ?? 0;
  // Audiobookshelf keeps its own position (e.g. from its web player); use it if newer.
  if (isAbsBook(nextBook)) {
    const remote = await absResumePoint(nextBook).catch(() => null);
    if (remote && (!saved || remote.updatedAt > saved.updatedAt)) {
      index = remote.chapter;
      position = remote.position;
    }
  }
  return loadChapter(nextBook, index, position, autoPlay);
}

/** Opens a book at your saved spot without playing (already open? leaves it as it is). */
async function openBook(nextBook: PlayableBook) {
  if (state.book?.key === nextBook.key && getAudio().isLoaded) return;
  return playBook(nextBook, undefined, false);
}

async function jumpTo(index: number, position: number) {
  const { book, chapterIndex } = state;
  if (!book) return;
  const p = getAudio();
  if (index === chapterIndex && p.isLoaded) {
    p.seekTo(position);
    if (!p.playing) p.play();
  } else {
    await loadChapter(book, index, position);
  }
}

function next() {
  const { book, chapterIndex } = state;
  if (!book) return;
  const p = getAudio();
  const marks = book.chapters[chapterIndex]?.marks ?? [];
  const mark = currentMark(book.chapters[chapterIndex], p.currentTime);
  if (mark && mark.index + 1 < marks.length) p.seekTo(marks[mark.index + 1].start);
  else if (chapterIndex + 1 < book.chapters.length) loadChapter(book, chapterIndex + 1);
}

// Like a CD player: restart the current chapter, or go back one if you're at its start.
function previous() {
  const { book, chapterIndex } = state;
  if (!book) return;
  const p = getAudio();
  const marks = book.chapters[chapterIndex]?.marks ?? [];
  const mark = currentMark(book.chapters[chapterIndex], p.currentTime);
  const chapterStart = mark?.start ?? 0;
  if (p.currentTime - chapterStart > RESTART_THRESHOLD_S) p.seekTo(chapterStart);
  else if (mark && mark.index > 0) p.seekTo(marks[mark.index - 1].start);
  else if (chapterIndex > 0) loadChapter(book, chapterIndex - 1);
  else p.seekTo(0);
}

function setSleep(sleep: Sleep) {
  if (sleepTimer) clearTimeout(sleepTimer);
  sleepTimer = null;
  sleepMark = null;
  if (sleep?.kind === 'minutes') {
    sleepTimer = setTimeout(
      () => {
        getAudio().pause();
        setSleep(null);
      },
      Math.max(0, sleep.at - Date.now()),
    );
  }
  update({ sleep });
}

function setRate(rate: number) {
  update({ rate });
  getAudio().setPlaybackRate(rate);
}

// --- React ----------------------------------------------------------------------

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
  /** Loads a book at your saved spot, paused (play with the Play button). */
  openBook: (book: PlayableBook) => Promise<void>;
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

export function PlayerProvider({ children }: { children: ReactNode }) {
  const player = getAudio();
  const status = useAudioPlayerStatus(player);
  const engine = useSyncExternalStore(subscribe, snapshot, snapshot);
  const { prefs } = usePrefs();

  // Preferences the engine uses while no screen is open.
  useEffect(() => {
    options.autoNextChapter = prefs.autoNextChapter;
    if (!options.rateSet) {
      options.rateSet = true;
      if (!state.book) update({ rate: prefs.defaultRate });
    }
  }, [prefs.autoNextChapter, prefs.defaultRate]);

  const { book, chapterIndex } = engine;
  const chapter = book?.chapters[chapterIndex];
  const mark = currentMark(chapter, status.currentTime);
  const marks = chapter?.marks ?? [];
  const hasNext =
    !!book &&
    ((!!mark && mark.index + 1 < marks.length) || chapterIndex + 1 < book.chapters.length);

  const value: PlayerContextValue = {
    book,
    chapterIndex,
    mark,
    playing: status.playing,
    loading: engine.loading || (status.isBuffering && !status.playing),
    error: engine.error ?? status.error ?? null,
    position: status.currentTime,
    duration: status.duration,
    rate: engine.rate,
    sleep: engine.sleep,
    playBook,
    openBook,
    playChapter: async (index: number) => {
      if (state.book) await loadChapter(state.book, index);
    },
    jumpTo,
    next,
    previous,
    hasNext,
    hasPrevious: !!book,
    toggle: () => (player.playing ? player.pause() : player.play()),
    seekTo: (s) => player.seekTo(Math.max(0, s)),
    seekBy: (s) =>
      player.seekTo(Math.min(Math.max(0, player.currentTime + s), player.duration || Infinity)),
    setRate,
    setSleep,
    addBookmark: async (note?: string) => {
      if (!book) return;
      await storeBookmark(book.key, {
        chapter: chapterIndex,
        position: player.currentTime,
        label: mark?.title ?? chapter?.title ?? `Chapter ${chapterIndex + 1}`,
        note: note?.trim() || undefined,
      });
    },
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
