/**
 * Statistics: how long you listen, watch and read. Kept on the phone only.
 *
 * Time is real time spent playing (not book/video position), counted in small
 * steps while something plays and saved every few seconds.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { emitFamilyEvent } from './family';

const KEY = '128bit.stats';

export type Day = { listen: number; watch: number; chapters: number };

export type WatchKind = 'movie' | 'episode' | 'live';

export type Stats = {
  /** "2026-10-01" → seconds listened / watched and chapters read that day. */
  days: Record<string, Day>;
  books: Record<string, { title: string; author?: string; seconds: number; finished?: boolean; finishedAt?: number }>;
  /** Movies, episodes and channels, keyed by their id. */
  watched: Record<
    string,
    { title: string; subtitle?: string; kind: WatchKind; seconds: number; finished?: boolean; finishedAt?: number; at: number }
  >;
  comics: Record<string, { title: string; chapters: number }>;
  since: number;
};

const empty = (): Stats => ({ days: {}, books: {}, watched: {}, comics: {}, since: Date.now() });

let cache: Stats | null = null;
let dirty = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export async function getStats(): Promise<Stats> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? { ...empty(), ...JSON.parse(raw) } : empty();
  } catch {
    cache = empty();
  }
  return cache!;
}

function scheduleSave() {
  dirty = true;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    if (dirty && cache) {
      dirty = false;
      AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => {});
    }
  }, 5000);
}

export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function today(s: Stats) {
  const k = dayKey();
  return (s.days[k] ??= { listen: 0, watch: 0, chapters: 0 });
}

export async function addListening(
  book: { key: string; title: string; author?: string },
  seconds: number,
) {
  const s = await getStats();
  today(s).listen += seconds;
  const b = (s.books[book.key] ??= { title: book.title, author: book.author, seconds: 0 });
  b.seconds += seconds;
  b.title = book.title;
  scheduleSave();
}

export async function markBookFinished(book: { key: string; title: string; author?: string }) {
  const s = await getStats();
  const b = (s.books[book.key] ??= { title: book.title, author: book.author, seconds: 0 });
  if (!b.finished) {
    b.finishedAt = Date.now();
    emitFamilyEvent('book.finished', { title: book.title, author: book.author });
  }
  b.finished = true;
  scheduleSave();
}

export async function addWatching(
  item: { key: string; title: string; subtitle?: string; kind: WatchKind },
  seconds: number,
) {
  const s = await getStats();
  today(s).watch += seconds;
  const w = (s.watched[item.key] ??= {
    title: item.title,
    subtitle: item.subtitle,
    kind: item.kind,
    seconds: 0,
    at: Date.now(),
  });
  w.seconds += seconds;
  w.at = Date.now();
  scheduleSave();
}

/** Counted as watched once you get near the end. */
export async function markWatched(item: {
  key: string;
  title: string;
  subtitle?: string;
  kind: WatchKind;
}) {
  const s = await getStats();
  const w = (s.watched[item.key] ??= { ...item, seconds: 0, at: Date.now() });
  if (!w.finished) {
    w.finishedAt = Date.now();
    if (item.kind === 'movie') emitFamilyEvent('movie.watched', { title: item.title });
    if (item.kind === 'episode') emitFamilyEvent('episode.watched', { show: item.title, episode: item.subtitle });
  }
  w.finished = true;
  scheduleSave();
}

export async function addChapterRead(comic: { id: string; title: string }) {
  const s = await getStats();
  today(s).chapters += 1;
  const c = (s.comics[comic.id] ??= { title: comic.title, chapters: 0 });
  c.chapters += 1;
  emitFamilyEvent('chapter.read', { comic: comic.title });
  scheduleSave();
}

export type Summary = {
  listen: number;
  watch: number;
  chapters: number;
  books: number;
  movies: number;
  episodes: number;
  shows: number;
};

/** Totals for everything (no year) or one calendar year. Older finishes without a date count to "all". */
export function summarize(s: Stats, year?: number): Summary {
  const inYear = (t?: number) => year === undefined || (!!t && new Date(t).getFullYear() === year);
  const days = Object.entries(s.days)
    .filter(([k]) => year === undefined || k.startsWith(`${year}-`))
    .map(([, d]) => d);
  const done = Object.values(s.watched).filter((w) => w.finished && inYear(w.finishedAt ?? w.at));
  const episodes = done.filter((w) => w.kind === 'episode');
  return {
    listen: days.reduce((n, d) => n + d.listen, 0),
    watch: days.reduce((n, d) => n + d.watch, 0),
    chapters: days.reduce((n, d) => n + d.chapters, 0),
    books: Object.values(s.books).filter((b) => b.finished && inYear(b.finishedAt)).length,
    movies: done.filter((w) => w.kind === 'movie').length,
    episodes: episodes.length,
    shows: new Set(episodes.map((e) => e.title)).size,
  };
}

/** Days in a row with any listening, watching or reading; best single day. */
export function streaks(s: Stats) {
  const active = (k: string) => {
    const d = s.days[k];
    return !!d && (d.listen + d.watch >= 60 || d.chapters > 0);
  };
  const d = new Date();
  if (!active(dayKey(d))) d.setDate(d.getDate() - 1); // today isn't over yet
  let current = 0;
  while (active(dayKey(d))) {
    current++;
    d.setDate(d.getDate() - 1);
  }
  let longest = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const k of Object.keys(s.days).sort()) {
    if (!active(k)) continue;
    const day = new Date(`${k}T12:00:00`);
    run = prev && Math.round((day.getTime() - prev.getTime()) / 86_400_000) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = day;
  }
  const best = Object.entries(s.days).sort(([, a], [, b]) => b.listen + b.watch - (a.listen + a.watch))[0];
  const activeDays = Object.keys(s.days).filter(active).length;
  return {
    current,
    longest: Math.max(longest, current),
    best: best ? { day: best[0], seconds: best[1].listen + best[1].watch } : null,
    activeDays,
  };
}

export async function resetStats() {
  cache = empty();
  await AsyncStorage.setItem(KEY, JSON.stringify(cache));
}

/** "3 h 12 min", "45 min", "<1 min". */
export function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  if (m < 1) return seconds > 0 ? '<1 min' : '0 min';
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d >= 2) return `${d} d ${h % 24} h`;
  return h ? `${h} h ${m % 60} min` : `${m} min`;
}
