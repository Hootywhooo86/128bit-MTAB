/**
 * 128bit Tracker: your lists, watchlist, Up next and calendar, from the same
 * 128bit account you sign in with here (Settings → Account). Each account sees
 * only its own. What you finish here reaches Tracker through the family feed
 * (lib/family.ts); this file reads Tracker back. Functions:
 * 128bittracker/supabase/tracker.sql (API: 128bittracker/docs/TRACKER-RPC.md).
 */
import { getSession, isSignedIn, onAccount, rpc } from './account';
import { imdbIdFor } from './tmdb';
import type { TraktItem } from './trakt-library';

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
  season?: number | null;
  ids: { imdb?: string; tmdb?: number; tvdb?: number; anilist?: number; mal?: number; kitsu?: number | string; trakt?: number };
  next?: { season: number; number: number };
  /** 0..100 through the whole title, and where you are right now (from any device). */
  pct?: number | null;
  now?: { pct?: number; episode?: number; chapter?: string; page?: number; position_s?: number; duration_s?: number; at?: string } | null;
};

export type TrackerList = { id: string; name: string; kind: TrackerKind; item_count: number; show_in_play: boolean };

const TTL = 5 * 60_000;
const cache = new Map<string, { at: number; value: unknown }>();
onAccount(() => cache.clear()); // another account: another library

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}
export const invalidateTracker = () => cache.clear();

/** Signed in to a 128bit account (Tracker lists are per account). */
export async function trackerSignedIn() {
  return isSignedIn(await getSession());
}

/** Tracker's own kinds for a Play tab. */
export const kindFor = (type: 'movie' | 'series' | 'anime'): TrackerKind => (type === 'movie' ? 'movie' : type === 'anime' ? 'anime' : 'show');

/** Lists marked "Show in 128bitPlay" for this tab (plus "anything" lists). */
export function getTrackerLists(kind: TrackerKind) {
  return cached(`lists:${kind}`, () => rpc<TrackerList[]>('get_lists', { kind, play_only: true }));
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
export function getTrackerCalendar(days = 30) {
  return cached(`calendar:${days}`, () => rpc<CalendarEntry[]>('get_calendar', { days }));
}

/** This title in your Tracker library (seasons of a show are one item each). */
export function getTrackerProgress(imdb: string) {
  return rpc<TrackerItem[]>('get_item_progress', { ids: { imdb } });
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

/**
 * Tracker items as rows of posters. Play opens titles by IMDb id; items that
 * only have a TMDB id are looked up (shows without either can't open here).
 */
export async function asRowItems(items: TrackerItem[]): Promise<TraktItem[]> {
  const out: TraktItem[] = [];
  for (const i of items) {
    if (!['movie', 'show', 'anime'].includes(i.type)) continue;
    let imdb = i.ids?.imdb;
    if (!imdb && i.ids?.tmdb) imdb = (await imdbIdFor(Number(i.ids.tmdb), i.type === 'movie' ? 'movie' : 'tv').catch(() => null)) ?? undefined;
    if (!imdb) continue;
    const ep = i.next;
    out.push({
      kind: ep ? 'episode' : i.type === 'movie' ? 'movie' : 'show',
      title: i.title,
      year: i.year ?? undefined,
      imdb,
      season: ep?.season,
      episode: ep?.number,
      subtitle: ep ? `S${ep.season} E${ep.number}` : undefined,
    });
  }
  return out;
}
