/**
 * Everything Trakt, read and write: watchlist, history (watched), collection,
 * ratings, favorites, personal lists, up next, calendar, recommendations,
 * check-in, playback progress and stats.
 *
 * 128bit identifies titles by IMDb id ("tt…"); episodes as "tt…:season:episode".
 */
import { traktApi } from './trakt';

export type Kind = 'movie' | 'show';

export type TraktIds = { trakt?: number; slug?: string; imdb?: string; tmdb?: number; tvdb?: number };

/** One row in any Trakt list, shaped for the app. */
export type TraktItem = {
  kind: Kind | 'episode';
  title: string;
  year?: number;
  imdb?: string;
  traktId?: number;
  /** Episodes: "S2 E5 · Title". */
  subtitle?: string;
  season?: number;
  episode?: number;
  /** When it was added / watched / rated / airs. */
  at?: string;
  rating?: number;
  /** History row id (to remove one play) or list item id. */
  rowId?: number;
};

export const poster = (imdb?: string) =>
  imdb ? `https://images.metahub.space/poster/small/${imdb}/img` : undefined;

/** Where tapping an item goes in 128bit. */
export function linkFor(item: TraktItem) {
  if (!item.imdb) return null;
  return { type: item.kind === 'movie' ? 'movie' : 'series', id: item.imdb };
}

/** genres / language only come with ?extended=full. */
type RawMovie = { title: string; year?: number; ids: TraktIds; genres?: string[]; language?: string };
type RawShow = RawMovie;
type RawEpisode = { season: number; number: number; title?: string; ids: TraktIds };
type Raw = {
  id?: number;
  type?: 'movie' | 'show' | 'episode' | 'season';
  movie?: RawMovie;
  show?: RawShow;
  episode?: RawEpisode;
  listed_at?: string;
  watched_at?: string;
  collected_at?: string;
  rated_at?: string;
  first_aired?: string;
  last_watched_at?: string;
  rating?: number;
};

function toItem(r: Raw): TraktItem | null {
  if (r.episode && r.show) {
    const e = r.episode;
    return {
      kind: 'episode',
      title: r.show.title,
      year: r.show.year,
      imdb: r.show.ids.imdb,
      traktId: r.show.ids.trakt,
      subtitle: `S${e.season} E${e.number}${e.title ? ` · ${e.title}` : ''}`,
      season: e.season,
      episode: e.number,
      at: r.watched_at ?? r.first_aired ?? r.rated_at ?? r.listed_at,
      rating: r.rating,
      rowId: r.id,
    };
  }
  const m = r.movie ?? r.show;
  if (!m) return null;
  return {
    kind: r.movie ? 'movie' : 'show',
    title: m.title,
    year: m.year,
    imdb: m.ids.imdb,
    traktId: m.ids.trakt,
    at: r.listed_at ?? r.watched_at ?? r.collected_at ?? r.rated_at ?? r.last_watched_at,
    rating: r.rating,
    rowId: r.id,
  };
}

const items = (rows: Raw[] | null) => (rows ?? []).map(toItem).filter(Boolean) as TraktItem[];
const plural = (k: Kind) => (k === 'movie' ? 'movies' : 'shows');

/** Request body for one title: { movies: [...] } or { shows: [...] }. */
function body(kind: Kind, imdb: string, extra: Record<string, unknown> = {}) {
  return { [plural(kind)]: [{ ids: { imdb }, ...extra }] };
}

function episodeBody(imdb: string, season: number, episode: number, extra: Record<string, unknown> = {}) {
  return { shows: [{ ids: { imdb }, seasons: [{ number: season, episodes: [{ number: episode, ...extra }] }] }] };
}

// --- Cache for "is it on my watchlist / rated / collected?" on title pages -------

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, load: () => Promise<T>, ms = 5 * 60_000): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}
const invalidate = (...prefixes: string[]) => {
  for (const k of [...cache.keys()]) if (prefixes.some((p) => k.startsWith(p))) cache.delete(k);
};

// --- Watchlist ----------------------------------------------------------------------

export const getWatchlist = (kind: Kind) =>
  cached(`watchlist:${kind}`, async () =>
    items(await traktApi<Raw[]>('GET', `/sync/watchlist/${plural(kind)}/added`)),
  );

export async function setWatchlist(kind: Kind, imdb: string, on: boolean) {
  await traktApi('POST', `/sync/watchlist${on ? '' : '/remove'}`, body(kind, imdb));
  invalidate('watchlist:');
}

// --- History / watched ----------------------------------------------------------------

export async function getHistory(page = 1): Promise<TraktItem[]> {
  return items(await traktApi<Raw[]>('GET', `/sync/history?page=${page}&limit=40`));
}

export const getWatchedMovies = () =>
  cached('watched:movies', async () => {
    const rows = await traktApi<{ movie: RawMovie }[]>('GET', '/sync/watched/movies');
    return new Set(rows.map((r) => r.movie.ids.imdb).filter(Boolean) as string[]);
  });

/** Marks a movie, a whole show, or one episode watched (now) or unwatched (all plays). */
export async function setWatched(kind: Kind, imdb: string, on: boolean) {
  await traktApi(
    'POST',
    `/sync/history${on ? '' : '/remove'}`,
    body(kind, imdb, on ? { watched_at: new Date().toISOString() } : {}),
  );
  invalidate('watched:', 'progress:', 'upnext');
}

export async function setEpisodeWatched(imdb: string, season: number, episode: number, on: boolean) {
  await traktApi(
    'POST',
    `/sync/history${on ? '' : '/remove'}`,
    episodeBody(imdb, season, episode, on ? { watched_at: new Date().toISOString() } : {}),
  );
  invalidate('progress:', 'upnext');
}

// An episode played to the end: the show page ticks it straight away.
const finishedListeners = new Set<(imdb: string, key: string) => void>();
export function onEpisodeFinished(f: (imdb: string, key: string) => void) {
  finishedListeners.add(f);
  return () => void finishedListeners.delete(f);
}

/**
 * Episode `key` ("tt…:season:episode") was watched to the end. With scrobbling on, Trakt
 * already records it; otherwise it's added to the history here.
 */
export async function episodeFinished(key: string, scrobbled: boolean) {
  const m = key.match(/^(tt\d+):(\d+):(\d+)$/);
  if (!m) return;
  finishedListeners.forEach((f) => f(m[1], `${m[2]}:${m[3]}`));
  if (scrobbled) invalidate('progress:', 'upnext');
  else await setEpisodeWatched(m[1], Number(m[2]), Number(m[3]), true);
}

export async function removeHistoryRow(rowId: number) {
  await traktApi('POST', '/sync/history/remove', { ids: [rowId] });
  invalidate('watched:', 'progress:', 'upnext');
}

/** Watched episodes of a show, as "season:episode" keys. */
export const getShowProgress = (imdb: string) =>
  cached(`progress:${imdb}`, async () => {
    const p = await traktApi<{
      aired: number;
      completed: number;
      seasons: { number: number; episodes: { number: number; completed: boolean }[] }[];
      next_episode?: RawEpisode | null;
    }>('GET', `/shows/${imdb}/progress/watched?hidden=false&specials=false`);
    const done = new Set<string>();
    p.seasons.forEach((s) => s.episodes.forEach((e) => e.completed && done.add(`${s.number}:${e.number}`)));
    return { done, aired: p.aired, completed: p.completed, next: p.next_episode ?? null };
  }, 60_000);

/** Shows you're watching, with the next episode to watch (most recently watched first). */
export const getUpNext = () =>
  cached('upnext', async () => {
    const watched = await traktApi<{ last_watched_at: string; show: RawShow }[]>(
      'GET',
      '/sync/watched/shows?extended=noseasons',
    );
    const recent = watched
      .filter((w) => w.show.ids.imdb)
      .sort((a, b) => b.last_watched_at.localeCompare(a.last_watched_at))
      .slice(0, 15);
    const rows = await Promise.all(
      recent.map(async (w) => {
        const p = await getShowProgress(w.show.ids.imdb!).catch(() => null);
        if (!p?.next) return null;
        const e = p.next;
        const item: TraktItem = {
          kind: 'episode',
          title: w.show.title,
          imdb: w.show.ids.imdb,
          traktId: w.show.ids.trakt,
          subtitle: `S${e.season} E${e.number}${e.title ? ` · ${e.title}` : ''} · ${p.aired - p.completed} left`,
          season: e.season,
          episode: e.number,
          at: w.last_watched_at,
        };
        return item;
      }),
    );
    return rows.filter(Boolean) as TraktItem[];
  }, 2 * 60_000);

// --- Collection ---------------------------------------------------------------------

export const getCollection = (kind: Kind) =>
  cached(`collection:${kind}`, async () => items(await traktApi<Raw[]>('GET', `/sync/collection/${plural(kind)}`)));

export async function setCollected(kind: Kind, imdb: string, on: boolean) {
  await traktApi(
    'POST',
    `/sync/collection${on ? '' : '/remove'}`,
    body(kind, imdb, on ? { collected_at: new Date().toISOString() } : {}),
  );
  invalidate('collection:');
}

// --- Ratings ------------------------------------------------------------------------

export const getRatings = (kind: Kind | 'episode') =>
  cached(`ratings:${kind}`, async () =>
    items(await traktApi<Raw[]>('GET', `/sync/ratings/${kind === 'episode' ? 'episodes' : plural(kind)}`)),
  );

/** 1–10, or 0 to remove your rating. */
export async function rate(kind: Kind, imdb: string, rating: number) {
  if (rating > 0) await traktApi('POST', '/sync/ratings', body(kind, imdb, { rating }));
  else await traktApi('POST', '/sync/ratings/remove', body(kind, imdb));
  invalidate('ratings:');
}

// --- Favorites ----------------------------------------------------------------------

export const getFavorites = (kind: Kind) =>
  cached(`favorites:${kind}`, async () => items(await traktApi<Raw[]>('GET', `/sync/favorites/${plural(kind)}`)));

export async function setFavorite(kind: Kind, imdb: string, on: boolean) {
  await traktApi('POST', `/sync/favorites${on ? '' : '/remove'}`, body(kind, imdb));
  invalidate('favorites:');
}

// --- Personal lists -------------------------------------------------------------------

export type TraktList = { id: number; slug: string; name: string; description?: string; itemCount: number; privacy: string };

export const getLists = () =>
  cached('lists', async () => {
    const rows = await traktApi<
      { name: string; description?: string; item_count: number; privacy: string; ids: { trakt: number; slug: string } }[]
    >('GET', '/users/me/lists');
    return rows.map<TraktList>((l) => ({
      id: l.ids.trakt,
      slug: l.ids.slug,
      name: l.name,
      description: l.description,
      itemCount: l.item_count,
      privacy: l.privacy,
    }));
  });

export async function createList(name: string, privacy: 'private' | 'friends' | 'public' = 'private') {
  await traktApi('POST', '/users/me/lists', { name, privacy });
  invalidate('lists');
}

export async function deleteList(id: number) {
  await traktApi('DELETE', `/users/me/lists/${id}`);
  invalidate('lists', 'list:');
}

export const getListItems = (id: number) =>
  cached(`list:${id}`, async () => items(await traktApi<Raw[]>('GET', `/users/me/lists/${id}/items`)), 60_000);

export async function setInList(id: number, kind: Kind, imdb: string, on: boolean) {
  await traktApi('POST', `/users/me/lists/${id}/items${on ? '' : '/remove'}`, body(kind, imdb));
  invalidate('lists', `list:${id}`);
}

// --- Calendar, recommendations, check-in, playback, stats ---------------------------------

/** Episodes of your shows airing from today for `days` days. */
export async function getCalendar(days = 14): Promise<TraktItem[]> {
  const start = new Date().toISOString().slice(0, 10);
  return items(await traktApi<Raw[]>('GET', `/calendars/my/shows/${start}/${days}`));
}

export async function getRecommendations(kind: Kind): Promise<TraktItem[]> {
  const rows = await traktApi<(RawMovie | RawShow)[]>('GET', `/recommendations/${plural(kind)}?limit=30&ignore_collected=true`);
  return rows.map((m) => ({ kind, title: m.title, year: m.year, imdb: m.ids.imdb, traktId: m.ids.trakt }));
}

// --- Discovery rows for the Shows / Movies tabs -------------------------------------------

/** Rows you can add to the Shows / Movies tabs (Settings → Tracking → Trakt rows). */
export const TRAKT_ROWS = [
  { id: 'upnext', name: 'Up next', shows: true, movies: false },
  { id: 'watchlist', name: 'Your watchlist', shows: true, movies: true },
  { id: 'recommended', name: 'Recommended for you', shows: true, movies: true },
  { id: 'trending', name: 'Trending now', shows: true, movies: true },
  { id: 'popular', name: 'Popular', shows: true, movies: true },
  { id: 'anticipated', name: 'Most anticipated', shows: true, movies: true },
  { id: 'watched', name: 'Most watched this week', shows: true, movies: true },
  { id: 'boxoffice', name: 'Box office', shows: false, movies: true },
] as const;

/** One discovery row ("trending", …) or a personal list ("list:123"). */
export function getTraktRow(row: string, kind: Kind): Promise<TraktItem[]> {
  const p = plural(kind);
  if (row.startsWith('list:')) return getListItems(Number(row.slice(5))).then((l) => l.filter((i) => i.kind === kind));
  switch (row) {
    case 'upnext':
      return getUpNext();
    case 'watchlist':
      return getWatchlist(kind);
    case 'recommended':
      return getRecommendations(kind);
    case 'popular':
      // Bare titles, not wrapped like the others.
      return cached(`row:${row}:${p}`, async () =>
        (await traktApi<(RawMovie | RawShow)[]>('GET', `/${p}/popular?limit=30`)).map((m) => ({
          kind,
          title: m.title,
          year: m.year,
          imdb: m.ids.imdb,
          traktId: m.ids.trakt,
        })),
      );
    default: {
      const path = { trending: 'trending', anticipated: 'anticipated', watched: 'watched/weekly', boxoffice: 'boxoffice' }[row];
      if (!path) return Promise.resolve([]);
      return cached(`row:${row}:${p}`, async () => items(await traktApi<Raw[]>('GET', `/${p}/${path}?limit=30`)));
    }
  }
}

/** Trakt's own title search (finds things your addons' catalogs miss). */
export const searchTrakt = (kind: Kind, query: string) =>
  cached(`search:${kind}:${query}`, async () =>
    items(await traktApi<Raw[]>('GET', `/search/${kind}?query=${encodeURIComponent(query)}&limit=20`)),
  );

/** Anime only, from your watchlist ("watchlist") or one of your lists ("list:123"), for the Anime tab. */
export const getAnimeRow = (row: string) =>
  cached(`anime:${row}`, async () => {
    const path = row === 'watchlist' ? '/sync/watchlist' : `/users/me/lists/${row.slice(5)}/items`;
    const rows = await traktApi<Raw[]>('GET', `${path}?extended=full`);
    const anime = (m?: RawMovie) =>
      !!m?.genres?.includes('anime') || (m?.language === 'ja' && !!m.genres?.includes('animation'));
    return items(rows.filter((r) => anime(r.show ?? r.movie)));
  });

/** "Not interested": hides it from your recommendations. */
export async function hideRecommendation(kind: Kind, traktId: number) {
  await traktApi('DELETE', `/recommendations/${plural(kind)}/${traktId}`);
}

export async function checkIn(kind: 'movie' | 'episode', imdb: string, season?: number, episode?: number) {
  const target =
    kind === 'movie'
      ? { movie: { ids: { imdb } } }
      : { show: { ids: { imdb } }, episode: { season, number: episode } };
  try {
    await traktApi('POST', '/checkin', { ...target, app_version: '128bit' });
  } catch (e) {
    if (String(e).includes('409')) throw new Error('You’re already checked in to something on Trakt.');
    throw e;
  }
}

export const cancelCheckIn = () => traktApi('DELETE', '/checkin');

export type PlaybackRow = { id: number; progress: number; item: TraktItem };

export async function getPlaybackRows(): Promise<PlaybackRow[]> {
  const rows = await traktApi<(Raw & { id: number; progress: number })[]>('GET', '/sync/playback?limit=50');
  return rows.flatMap((r) => {
    const item = toItem(r);
    return item ? [{ id: r.id, progress: r.progress, item }] : [];
  });
}

export const removePlayback = (id: number) => traktApi('DELETE', `/sync/playback/${id}`);

export type TraktStats = {
  movies: { plays: number; watched: number; minutes: number; collected: number; ratings: number };
  shows: { watched: number; collected: number; ratings: number };
  episodes: { plays: number; watched: number; minutes: number; collected: number };
  ratings: { total: number };
};

export const getTraktStats = () => traktApi<TraktStats>('GET', '/users/me/stats');

/** Everything a title page shows about one movie or show, in one go. */
export async function titleState(kind: Kind, imdb: string) {
  const has = (list: TraktItem[]) => list.some((i) => i.imdb === imdb);
  const [watchlist, collection, ratings, favorites, watchedMovies] = await Promise.all([
    getWatchlist(kind).catch(() => []),
    getCollection(kind).catch(() => []),
    getRatings(kind).catch(() => []),
    getFavorites(kind).catch(() => []),
    kind === 'movie' ? getWatchedMovies().catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
  ]);
  return {
    watchlist: has(watchlist),
    collected: has(collection),
    favorite: has(favorites),
    rating: ratings.find((r) => r.imdb === imdb)?.rating ?? 0,
    watched: kind === 'movie' ? watchedMovies.has(imdb) : false,
  };
}
