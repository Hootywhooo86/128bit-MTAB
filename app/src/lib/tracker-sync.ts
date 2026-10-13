/**
 * Everything you read, watch and listen to here, in your 128bit Tracker: audiobooks
 * (listening and finished), comics (chapters read), movies and show seasons (watched and
 * in progress, down to how far into each one: meta.pct and meta.now), plus Wanted books
 * as planned. Sent with the 128bit sign-in to
 * track_items, which only ever moves things forward (128bittracker/supabase/tracker.sql),
 * so running it again is harmless. Runs after sign-in, then at most every 30 minutes
 * while the app is open, and from Settings → Tracking → "Send my history now".
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { getSession, isSignedIn, onAccount, rpc } from './account';
import { getAllComicProgress, getComicLibrary } from './comics';
import { getDownloadedBooks } from './downloads';
import { getStats } from './stats';
import { getLibrary, getProgressMany } from './storage';
import { invalidateTracker } from './tracker';
import { parseKey, pctOf } from './tracker-live';
import { getWatchProgress, isAnime } from './video';
import { getWanted } from './wanted';

const LAST_KEY = '128bit.trackerHistory.last';
const PRINT_KEY = '128bit.trackerHistory.print';
const EVERY_MS = 30 * 60_000;
const BATCH = 500;

export type HistoryItem = {
  type: 'movie' | 'show' | 'anime' | 'book' | 'comic';
  title: string;
  creator?: string;
  poster?: string;
  ids?: Record<string, string | number>;
  season?: number;
  status: 'planned' | 'active' | 'done';
  progress?: number;
  progress_total?: number;
  started_at?: string;
  finished_at?: string;
  meta?: Record<string, unknown>;
};

const iso = (ms?: number) => (ms ? new Date(ms).toISOString() : undefined);

/** Everything on this phone, as Tracker items. */
export async function collectHistory(): Promise<HistoryItem[]> {
  const out: HistoryItem[] = [];
  const stats = await getStats();

  // Audiobooks: listening or finished; Wanted ones as planned.
  const books = new Map<string, { title: string; author?: string; cover?: string }>();
  for (const b of [...(await getLibrary()), ...(await getDownloadedBooks().catch(() => []))]) books.set(b.key, b);
  for (const [key, b] of Object.entries(stats.books)) if (!books.has(key)) books.set(key, { title: b.title, author: b.author });
  const progress = await getProgressMany([...books.keys()]);
  const seenBooks = new Set<string>();
  for (const [key, b] of books) {
    const p = progress[key];
    const st = stats.books[key];
    const finished = p?.finished || st?.finished;
    const started = finished || (p && p.fraction > 0) || (st && st.seconds > 0);
    if (!started) continue;
    seenBooks.add(b.title.toLowerCase());
    out.push({
      type: 'book', title: b.title, creator: b.author, poster: b.cover,
      status: finished ? 'done' : 'active',
      finished_at: finished ? iso(st?.finishedAt ?? p?.updatedAt) : undefined,
      meta: (() => {
        const pct = finished ? 100 : p ? Math.round(p.fraction * 100) : undefined;
        return { format: 'audiobook', listened_pct: pct, pct };
      })(),
    });
  }
  for (const w of await getWanted().catch(() => [])) {
    if (seenBooks.has(w.title.toLowerCase())) continue;
    out.push({ type: 'book', title: w.title, creator: w.author, poster: w.cover, status: 'planned', meta: { format: 'audiobook' } });
  }

  // Comics: chapters read.
  const comicProgress = await getAllComicProgress();
  for (const c of await getComicLibrary()) {
    const cp = comicProgress[c.id];
    const read = cp?.read.length ?? stats.comics[c.id]?.chapters ?? 0;
    const total = Number(c.lastChapter);
    const reading = cp && !cp.read.includes(cp.chapterId) ? cp : undefined;
    const meta: Record<string, unknown> = {};
    if (total > 0) meta.pct = pctOf(read, total);
    // The chapter you're in the middle of, and the page.
    if (reading) meta.now = { chapter: reading.chapterLabel.replace(/^(ch(apter)?\.?\s*)/i, '').slice(0, 40), page: reading.page + 1, pages: reading.pages || undefined, pct: pctOf(reading.page + 1, reading.pages), at: iso(reading.updatedAt) };
    out.push({
      type: 'comic', title: c.title, creator: c.author, poster: c.cover,
      status: read > 0 || reading ? 'active' : 'planned', progress: read || undefined,
      progress_total: total > 0 && Number.isInteger(total) ? total : undefined,
      started_at: read || reading ? iso(cp?.updatedAt) : undefined,
      meta: Object.keys(meta).length ? meta : undefined,
    });
  }

  // Movies and show seasons, from what you've played here.
  const seasons = new Map<string, HistoryItem>();
  const movie = new Map<string, HistoryItem>();
  for (const [key, w] of Object.entries(stats.watched)) {
    if (w.kind === 'live') continue;
    const k = parseKey(key);
    if (w.kind === 'movie') {
      if (!w.finished && w.seconds < 60) continue;
      movie.set(key, { type: 'movie', title: w.title, ids: k?.ids, status: w.finished ? 'done' : 'active', finished_at: w.finished ? iso(w.finishedAt) : undefined, meta: w.finished ? { pct: 100 } : undefined });
      continue;
    }
    if (!k?.season || !k.episode) continue;
    const anime = k.anime || (await isAnime({ type: 'series', id: String(k.ids.imdb ?? '') }).catch(() => false));
    const sKey = `${w.title.toLowerCase()}|${k.season}`;
    const prev = seasons.get(sKey);
    const watchedUpTo = w.finished ? k.episode : k.episode - 1;
    const item: HistoryItem = prev ?? { type: anime ? 'anime' : 'show', title: w.title, ids: k.ids, season: k.season, status: 'active', progress: 0 };
    item.progress = Math.max(item.progress ?? 0, watchedUpTo);
    seasons.set(sKey, item);
  }
  // Continue watching: exactly how far into each movie and episode.
  for (const p of await getWatchProgress().catch(() => [])) {
    const k = parseKey(p.key);
    const pct = pctOf(p.position, p.duration);
    const now = { pct, position_s: Math.round(p.position), duration_s: Math.round(p.duration), at: iso(p.updatedAt) };
    if (p.link?.type === 'movie') {
      const prev = movie.get(p.key);
      if (prev?.status === 'done') continue; // already watched; a rewatch doesn't undo it
      movie.set(p.key, { ...(prev ?? { type: 'movie', title: p.title, ids: k?.ids, status: 'active' }), poster: prev?.poster ?? p.poster, meta: { pct, now } });
      continue;
    }
    if (!k?.season || !k.episode || !p.title) continue;
    const sKey = `${p.title.toLowerCase()}|${k.season}`;
    const anime = k.anime || (await isAnime({ type: 'series', id: String(k.ids.imdb ?? '') }).catch(() => false));
    const item = seasons.get(sKey) ?? { type: anime ? 'anime' : 'show', title: p.title, poster: p.poster, ids: k.ids, season: k.season, status: 'active', progress: k.episode - 1 };
    if (k.episode > (item.progress ?? 0)) {
      const prevNow = (item.meta?.now as { at?: string } | undefined)?.at;
      if (!prevNow || (now.at ?? '') > prevNow) item.meta = { ...item.meta, now: { ...now, episode: k.episode } };
    }
    seasons.set(sKey, item);
  }
  out.push(...movie.values(), ...seasons.values());
  return out.filter((i) => i.title);
}

let running: Promise<{ added: number; updated: number } | null> | null = null;

/** Send it all (only when something changed, or force). Never throws. */
export function syncHistoryToTracker(force = false) {
  running ??= (async () => {
    if (!isSignedIn(await getSession())) return null;
    if (!force) {
      const last = Number((await AsyncStorage.getItem(LAST_KEY)) ?? 0);
      if (Date.now() - last < EVERY_MS) return null;
    }
    const items = await collectHistory();
    const print = String(items.length) + ':' + hash(JSON.stringify(items));
    if (!force && (await AsyncStorage.getItem(PRINT_KEY)) === print) {
      await AsyncStorage.setItem(LAST_KEY, String(Date.now()));
      return { added: 0, updated: 0 };
    }
    let added = 0;
    let updated = 0;
    for (let i = 0; i < items.length; i += BATCH) {
      const r = await rpc<{ added: number; updated: number }>('track_items', { items: items.slice(i, i + BATCH) });
      added += r?.added ?? 0;
      updated += r?.updated ?? 0;
    }
    await AsyncStorage.multiSet([[LAST_KEY, String(Date.now())], [PRINT_KEY, print]]);
    if (added || updated) invalidateTracker();
    return { added, updated };
  })()
    .catch(() => null)
    .finally(() => {
      running = null;
    });
  return running;
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Signed in (or a sync finished): bring Tracker up to date.
onAccount(() => {
  syncHistoryToTracker();
});
