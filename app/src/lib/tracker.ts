/**
 * 128bit Tracker: your lists, watchlist, Up next and calendar, from the same
 * 128bit account you sign in with here (Settings → Account). Each account sees
 * only its own. What you finish here reaches Tracker through the family feed
 * (lib/family.ts); this file reads Tracker back. Functions:
 * 128bittracker/supabase/tracker.sql (API: 128bittracker/docs/TRACKER-RPC.md).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { getSession, isSignedIn, onAccount, rpc } from './account';
import { fetchMetas, supports, supportsSearch } from './addons';
import { searchKitsu } from './kitsu';
import { getActiveAddons } from './storage';
import { imdbIdFor } from './tmdb';
import { poster, type TraktItem } from './trakt-library';
import type { InstalledAddon, MetaPreview } from './types';

export type TrackerKind = 'movie' | 'show' | 'anime' | 'book' | 'comic' | 'game' | 'mixed';

export type TrackerItem = {
  id: string;
  type: string;
  title: string;
  year?: number | null;
  poster?: string | null;
  status: string;
  progress: number;
  progress_total?: number | null;
  rating?: number | null;
  /** A show: the season you're on, and each season's episodes watched ({"1": {p: 10, n: 10, done}}). */
  season?: number | null;
  seasons?: Record<string, { p: number; n?: number; a?: string; done?: string }> | null;
  ids: { imdb?: string; tmdb?: number; tvdb?: number; anilist?: number; mal?: number; kitsu?: number | string; trakt?: number };
  /** Up next; air_date when that episode hasn't aired yet (a new season coming). */
  next?: { season: number; number: number; air_date?: string };
  /** 0..100 through the whole title, and where you are right now (from any device). */
  pct?: number | null;
  now?: { pct?: number; episode?: number; chapter?: string; page?: number; position_s?: number; duration_s?: number; at?: string } | null;
};

export type TrackerList = { id: string; name: string; kind: TrackerKind; item_count: number; show_in_play: boolean };

const TTL = 5 * 60_000;
const cache = new Map<string, { at: number; value: unknown }>();
/** How each Tracker item opens here, once looked up (by Tracker item id). */
const opened = new Map<string, { id: string; openType: 'movie' | 'series' } | null>();
onAccount(() => invalidateTracker()); // another account: another library

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}
export function invalidateTracker() {
  cache.clear();
  opened.clear();
}

/** Signed in to a 128bit account (Tracker lists are per account). */
export async function trackerSignedIn() {
  return isSignedIn(await getSession());
}

/** The five lists every account starts with (Tracker's `starter_lists()`), by kind. */
export type StarterLists = { movie: string; show: string; anime: string; audiobooks: string; comic: string };

const STARTER_KEY = '128bit.tracker.starterLists';
let starter: { user: string; lists: StarterLists } | null = null;
let starterAsked: string | null = null;
let starterRunning: Promise<StarterLists | null> | null = null;

/**
 * Makes sure your five lists exist (Movies, Shows, Anime, Audiobooks, Comics) and gives
 * their ids. Asks the account server once per launch and account (it creates or reuses
 * them, so asking again is harmless); otherwise the saved answer. Null when signed out.
 */
export function getStarterLists(): Promise<StarterLists | null> {
  starterRunning ??= (async () => {
    const s = await getSession();
    if (!isSignedIn(s)) return null;
    const user = s.user.id;
    if (!starter || starter.user !== user) {
      try {
        const saved = JSON.parse((await AsyncStorage.getItem(STARTER_KEY)) ?? 'null') as typeof starter;
        if (saved?.user === user) starter = saved;
      } catch {
        // nothing saved
      }
    }
    if (starterAsked !== user || !starter || starter.user !== user) {
      try {
        const lists = await rpc<StarterLists>('starter_lists', {});
        if (lists?.audiobooks) {
          if (starterAsked !== user) cache.clear(); // the lists may be new
          starter = { user, lists };
          starterAsked = user;
          AsyncStorage.setItem(STARTER_KEY, JSON.stringify(starter)).catch(() => {});
        }
      } catch {
        // Older account server, or offline: the saved ids (if any).
      }
    }
    return starter?.user === user ? starter.lists : null;
  })().finally(() => {
    starterRunning = null;
  });
  return starterRunning;
}

/** Tracker's own kinds for a Play tab. */
export const kindFor = (type: 'movie' | 'series' | 'anime'): TrackerKind => (type === 'movie' ? 'movie' : type === 'anime' ? 'anime' : 'show');

/** Lists marked "Show in 128bitPlay" for this tab (plus "anything" lists). */
export function getTrackerLists(kind: TrackerKind) {
  return cached(`lists:${kind}`, () => rpc<TrackerList[]>('get_lists', { kind, play_only: true }));
}

/** Every list you've made in Tracker, whatever its kind (for choosing where each goes). */
export function getAllTrackerLists() {
  return cached('lists:all', () => rpc<TrackerList[]>('get_lists', { kind: null, play_only: false }));
}

/** Tabs a list shows on: the ones you picked here, else Tracker's own kind + "Show in 128bitPlay". */
export function listPlaces(list: TrackerList, places: Record<string, string[]>): string[] {
  if (places[list.id]) return places[list.id];
  if (!list.show_in_play) return [];
  if (list.kind === 'mixed') return ['movie', 'series', 'anime'];
  return list.kind === 'movie' ? ['movie'] : list.kind === 'anime' ? ['anime'] : list.kind === 'show' ? ['series'] : [];
}

export function getTrackerListItems(listId: string) {
  return cached(`list:${listId}`, () => rpc<TrackerItem[]>('get_list_items', { list_id: listId, page: 1, per_page: 60 }));
}

export function getTrackerWatchlist(kind?: TrackerKind) {
  return cached(`watchlist:${kind ?? ''}`, () => rpc<TrackerItem[]>('get_watchlist', { kind: kind ?? null, max_rows: 60 }));
}

/** Everything you're partway through, on any device, most recent first. */
export function getTrackerInProgress() {
  return cached('inprogress', () => rpc<TrackerItem[]>('get_in_progress', { max_rows: 40 }));
}

export function getTrackerUpNext() {
  return cached('upnext', () => rpc<TrackerItem[]>('get_up_next', { max_rows: 30 }));
}

export type CalendarEntry = { date: string; kind: string; title: string; detail?: string | null; item?: TrackerItem | null };
/** The phone's time zone (e.g. "America/Edmonton"), so "today" is your today, not UTC's. */
export const localTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
};

export function getTrackerCalendar(days = 30) {
  return cached(`calendar:${days}`, async () => {
    const tz = localTimeZone();
    if (tz) {
      try {
        return await rpc<CalendarEntry[]>('get_calendar_local', { days, tz });
      } catch {
        // Older account server without get_calendar_local: the UTC one.
      }
    }
    return rpc<CalendarEntry[]>('get_calendar', { days });
  });
}

/** This title in your Tracker library (a show is one item, its seasons inside). */
export function getTrackerProgress(imdb: string) {
  return rpc<TrackerItem[]>('get_item_progress', { ids: { imdb } });
}

/**
 * Which episodes of a show Tracker says you've watched, as "season:episode" keys,
 * by any id Play knows it by ({imdb} or {kitsu}). Older libraries had one item per season.
 */
export async function getTrackerWatchedEpisodes(ids: Record<string, string | number>): Promise<Set<string>> {
  const out = new Set<string>();
  if (!(await trackerSignedIn())) return out;
  const items = await rpc<TrackerItem[]>('get_item_progress', { ids });
  for (const i of items) {
    const seasons = i.seasons && Object.keys(i.seasons).length ? i.seasons : { [String(i.season ?? 1)]: { p: i.progress } };
    for (const [s, x] of Object.entries(seasons)) for (let e = 1; e <= Math.floor(x.p ?? 0); e++) out.add(`${s}:${e}`);
  }
  return out;
}

/** "Oct 30" (or "Oct 30, 2027" another year) for an upcoming episode. */
export function airDay(day: string) {
  const d = new Date(`${day}T12:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}

/** A title as 128bit Tracker knows it. ids: whatever this app knows ({imdb}, {kitsu}); books and comics go by title. */
export type TrackerRef = {
  type: 'movie' | 'show' | 'anime' | 'book' | 'comic';
  title: string;
  creator?: string;
  year?: number;
  poster?: string;
  ids?: Record<string, string | number>;
};
const refBody = (r: TrackerRef) => ({
  type: r.type, title: r.title, creator: r.creator ?? null, year: r.year ?? null, poster: r.poster ?? null, ids: r.ids ?? {},
});

/** This title in your Tracker library, or null. */
export function findInTracker(ref: TrackerRef) {
  return rpc<TrackerItem | null>('find_item', { item: refBody(ref) });
}

export async function addToTrackerList(listId: string, ref: TrackerRef) {
  invalidateTracker();
  return rpc<{ item_id: string }>('add_to_list', { list_id: listId, item: refBody(ref) });
}

export async function removeFromTrackerList(listId: string, itemId: string) {
  invalidateTracker();
  return rpc<void>('remove_from_list', { list_id: listId, item_id: itemId });
}

export async function createTrackerList(name: string, kind: TrackerKind) {
  invalidateTracker();
  return rpc<{ id: string }>('create_list', { name, kind, show_in_play: true });
}

/** Add to Tracker (planned), or take it off again while it's still only planned. */
export async function setTrackerWatchlist(ref: TrackerRef, on: boolean) {
  invalidateTracker();
  return rpc<{ item_id: string | null }>('set_watchlist', { item: refBody(ref), wanted: on });
}

export async function rateInTracker(itemId: string, rating: number | null) {
  invalidateTracker();
  return rpc<void>('rate', { item_id: itemId, rating });
}

/** A Tracker item as a poster: how Play opens it (`id` / `openType`) plus its Tracker poster. */
export type TrackerRowItem = TraktItem & { id: string; openType: 'movie' | 'series'; poster?: string };

const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** The first search result that is this title (same name, else same year, else the top one). */
function bestMatch(found: MetaPreview[], title: string, year?: number | null) {
  const yearOf = (m: MetaPreview) => Number(String(m.releaseInfo ?? '').slice(0, 4)) || null;
  const named = found.filter((m) => normTitle(m.name) === normTitle(title));
  return (
    named.find((m) => !year || yearOf(m) === year) ??
    named[0] ??
    (year ? found.find((m) => yearOf(m) === year) : undefined) ??
    found[0]
  );
}

/**
 * How Play opens a Tracker item: by IMDb id; else `kitsu:<id>` (the title page knows Kitsu);
 * else TMDB → IMDb (needs a TMDB key), or the TMDB / MAL / AniList id itself when an addon
 * can show it; else, last, a search by title. Null when nothing finds it.
 */
async function openFor(i: TrackerItem, addons: InstalledAddon[]) {
  const movie = i.type === 'movie';
  const type = movie ? 'movie' : 'series';
  const as = (id: string) => ({ id, openType: type as 'movie' | 'series' });
  const ids = i.ids ?? {};
  if (ids.imdb) return as(ids.imdb);
  if (ids.kitsu && /^\d+$/.test(String(ids.kitsu))) return as(`kitsu:${ids.kitsu}`);
  const known = opened.get(i.id);
  if (known !== undefined) return known;
  let out: { id: string; openType: 'movie' | 'series' } | null = null;
  if (ids.tmdb) {
    const imdb = await imdbIdFor(Number(ids.tmdb), movie ? 'movie' : 'tv').catch(() => null);
    if (imdb) out = as(imdb);
  }
  const canShow = (id: string) => addons.some((a) => supports(a, 'meta', type, id));
  for (const key of ['tmdb', 'mal', 'anilist', 'tvdb'] as const) {
    if (!out && ids[key] && canShow(`${key}:${ids[key]}`)) out = as(`${key}:${ids[key]}`);
  }
  if (!out && i.title) {
    // Last resort: find it by name (Kitsu for anime, then your addons' searches).
    const anime = i.type === 'anime';
    const found: MetaPreview[] = anime ? await searchKitsu(i.title, addons).catch(() => []) : [];
    if (!found.length) {
      const catalogs = addons.flatMap((a) =>
        a.manifest.catalogs.filter((c) => c.type === type && supportsSearch(c)).map((c) => ({ a, c })),
      );
      const results = await Promise.all(
        catalogs.slice(0, 6).map(({ a, c }) => fetchMetas(a, c, { search: i.title }).catch(() => [] as MetaPreview[])),
      );
      found.push(...results.flat());
    }
    const hit = bestMatch(found, i.title, i.year);
    if (hit) out = { id: hit.id, openType: hit.type === 'movie' ? 'movie' : 'series' };
  }
  opened.set(i.id, out);
  return out;
}

/** Tracker types a Shows / Movies / Anime tab can open ("other": whatever it is, try). */
const VIDEO_TYPES = ['movie', 'show', 'anime', 'other'];

/**
 * Tracker items as rows of posters. Every movie, show and anime gets a poster, whatever
 * ids it has (see openFor); only titles nothing can find are left out (and logged).
 */
export async function asRowItems(items: TrackerItem[]): Promise<TrackerRowItem[]> {
  const addons = await getActiveAddons().catch(() => [] as InstalledAddon[]);
  const rows = await Promise.all(
    items.map(async (i): Promise<TrackerRowItem | null> => {
      if (!VIDEO_TYPES.includes(i.type)) return null;
      const open = await openFor(i, addons).catch(() => null);
      if (!open) {
        console.warn(`Tracker: can't open "${i.title}" here (ids ${JSON.stringify(i.ids ?? {})})`);
        return null;
      }
      const imdb = /^tt\d+$/.test(open.id) ? open.id : undefined;
      const ep = i.next;
      return {
        ...open,
        kind: ep ? 'episode' : i.type === 'movie' ? 'movie' : 'show',
        title: i.title,
        year: i.year ?? undefined,
        imdb,
        poster: i.poster || poster(imdb),
        season: ep?.season,
        episode: ep?.number,
        // A new season coming: when it starts ("S2 E1 · Oct 30").
        subtitle: ep ? `S${ep.season} E${ep.number}${ep.air_date && ep.air_date > new Date().toISOString().slice(0, 10) ? ` · ${airDay(ep.air_date)}` : ''}` : undefined,
      };
    }),
  );
  // One poster per title (older libraries had an item per season).
  const seen = new Set<string>();
  return rows.filter((r): r is TrackerRowItem => !!r && !seen.has(`${r.id}:${r.subtitle ?? ''}`) && !!seen.add(`${r.id}:${r.subtitle ?? ''}`));
}
