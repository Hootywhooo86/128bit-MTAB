/**
 * TMDB enrichment: cast, trailer, age rating, logo and "More like this" for a
 * movie or show, looked up by its IMDb id. Uses your own TMDB API key (v3 key or
 * v4 read access token, free at themoviedb.org/settings/api).
 */
import { secureGet, secureSet } from './storage';

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const KEY = '128bit.tmdb';

let key: string | null | undefined;

export async function getTmdbKey() {
  if (key === undefined) key = await secureGet(KEY);
  return key;
}

async function get<T>(path: string, k?: string): Promise<T> {
  const apiKey = k ?? (await getTmdbKey());
  if (!apiKey) throw new Error('No TMDB key');
  // A v4 "read access token" is a long JWT and goes in the header; a v3 key goes in the URL.
  const bearer = apiKey.startsWith('eyJ');
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${API}${path}${bearer ? '' : `${sep}api_key=${apiKey}`}`, {
    headers: { Accept: 'application/json', ...(bearer ? { Authorization: `Bearer ${apiKey}` } : {}) },
  });
  const body = (await res.json().catch(() => null)) as (T & { status_message?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.status_message ?? `TMDB answered ${res.status}`);
  return body;
}

/** Checks the key, then saves it. Empty clears it. */
export async function setTmdbKey(value: string) {
  const v = value.trim();
  if (v) await get('/configuration', v);
  key = v || null;
  await secureSet(KEY, key);
}

export type CastMember = { name: string; role?: string; photo?: string };
export type Similar = { tmdbId: number; kind: 'movie' | 'tv'; title: string; poster?: string; year?: string };

export type Enrichment = {
  tmdbId: number;
  kind: 'movie' | 'tv';
  tagline?: string;
  overview?: string;
  certification?: string;
  runtime?: string;
  genres: string[];
  status?: string;
  logo?: string;
  backdrop?: string;
  cast: CastMember[];
  trailer?: { youtubeKey: string; name: string };
  similar: Similar[];
  seasons?: number;
  network?: string;
};

const cache = new Map<string, Promise<Enrichment | null>>();

type Video = { key: string; site: string; type: string; official?: boolean; name: string };
type Img = { file_path: string; iso_639_1: string | null };

/** Details for an IMDb id ("tt…"), or null if TMDB doesn't know it. Cached per session. */
export function enrich(imdbId: string, type: string): Promise<Enrichment | null> {
  const cacheKey = `${type}:${imdbId}`;
  let pending = cache.get(cacheKey);
  if (!pending) {
    pending = load(imdbId, type).catch((e) => {
      cache.delete(cacheKey);
      throw e;
    });
    cache.set(cacheKey, pending);
  }
  return pending;
}

async function load(imdbId: string, type: string): Promise<Enrichment | null> {
  if (!(await getTmdbKey()) || !/^tt\d+$/.test(imdbId)) return null;
  const found = await get<{ movie_results: { id: number }[]; tv_results: { id: number }[] }>(
    `/find/${imdbId}?external_source=imdb_id`,
  );
  const tv = found.tv_results[0];
  const movie = found.movie_results[0];
  const kind: 'movie' | 'tv' = type === 'movie' ? (movie ? 'movie' : 'tv') : tv ? 'tv' : 'movie';
  const id = kind === 'tv' ? tv?.id : movie?.id;
  if (!id) return null;

  const append =
    kind === 'movie'
      ? 'credits,videos,release_dates,recommendations,images'
      : 'aggregate_credits,videos,content_ratings,recommendations,images';
  const d = await get<any>(`/${kind}/${id}?append_to_response=${append}&include_image_language=en,null`);

  const videos: Video[] = d.videos?.results ?? [];
  const trailer =
    videos.find((v) => v.site === 'YouTube' && v.type === 'Trailer' && v.official) ??
    videos.find((v) => v.site === 'YouTube' && v.type === 'Trailer') ??
    videos.find((v) => v.site === 'YouTube' && v.type === 'Teaser');

  const certification =
    kind === 'movie'
      ? (d.release_dates?.results as { iso_3166_1: string; release_dates: { certification: string }[] }[] | undefined)
          ?.find((r) => r.iso_3166_1 === 'US')
          ?.release_dates.find((x) => x.certification)?.certification
      : (d.content_ratings?.results as { iso_3166_1: string; rating: string }[] | undefined)?.find(
          (r) => r.iso_3166_1 === 'US',
        )?.rating;

  const minutes: number | undefined = kind === 'movie' ? d.runtime : d.episode_run_time?.[0];
  const people = kind === 'movie' ? d.credits?.cast : d.aggregate_credits?.cast;
  const logos: Img[] = d.images?.logos ?? [];
  const logo = logos.find((l) => l.iso_639_1 === 'en') ?? logos[0];

  return {
    tmdbId: id,
    kind,
    tagline: d.tagline || undefined,
    overview: d.overview || undefined,
    certification: certification || undefined,
    runtime: minutes ? (minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`) : undefined,
    genres: (d.genres ?? []).map((g: { name: string }) => g.name),
    status: d.status,
    logo: logo ? `${IMG}/w500${logo.file_path}` : undefined,
    backdrop: d.backdrop_path ? `${IMG}/w1280${d.backdrop_path}` : undefined,
    cast: (people ?? []).slice(0, 15).map((p: any) => ({
      name: p.name,
      role: p.character ?? p.roles?.[0]?.character,
      photo: p.profile_path ? `${IMG}/w185${p.profile_path}` : undefined,
    })),
    trailer: trailer ? { youtubeKey: trailer.key, name: trailer.name } : undefined,
    similar: (d.recommendations?.results ?? []).slice(0, 15).map((r: any) => ({
      tmdbId: r.id,
      kind: r.media_type === 'tv' ? 'tv' : 'movie',
      title: r.title ?? r.name,
      poster: r.poster_path ? `${IMG}/w342${r.poster_path}` : undefined,
      year: (r.release_date ?? r.first_air_date)?.slice(0, 4),
    })),
    seasons: d.number_of_seasons,
    network: d.networks?.[0]?.name,
  };
}

/** The IMDb id for a TMDB title, so it can open in 128bit. */
export async function imdbIdFor(tmdbId: number, kind: 'movie' | 'tv'): Promise<string | null> {
  const ids = await get<{ imdb_id?: string | null }>(`/${kind}/${tmdbId}/external_ids`);
  return ids.imdb_id ?? null;
}
