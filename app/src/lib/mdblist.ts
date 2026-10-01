/**
 * MDBList ratings: IMDb, Rotten Tomatoes, audience score, Metacritic, Letterboxd,
 * Trakt, TMDB… for a movie or show, from one call. Uses your MDBList API key
 * (free at mdblist.com/preferences).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { secureGet, secureSet } from './storage';

const KEY = '128bit.mdblist';
const SOURCES_KEY = '128bit.mdblist.sources';

/** Ratings sources we know how to show, in display order. */
export const RATING_SOURCES = [
  { id: 'imdb', label: 'IMDb', max: 10 },
  { id: 'tomatoes', label: 'Rotten Tomatoes', max: 100, suffix: '%' },
  { id: 'audience', label: 'Audience', max: 100, suffix: '%' },
  { id: 'metacritic', label: 'Metacritic', max: 100 },
  { id: 'letterboxd', label: 'Letterboxd', max: 5 },
  { id: 'trakt', label: 'Trakt', max: 100, suffix: '%' },
  { id: 'tmdb', label: 'TMDB', max: 100, suffix: '%' },
  { id: 'myanimelist', label: 'MAL', max: 10 },
] as const;

export type RatingSourceId = (typeof RATING_SOURCES)[number]['id'];
export type Rating = { source: RatingSourceId; label: string; text: string; votes?: number };

let key: string | null | undefined;

export async function getMdblistKey() {
  if (key === undefined) key = await secureGet(KEY);
  return key;
}

type Raw = { ratings?: { source: string; value: number | null; score?: number | null; votes?: number | null }[] };

async function fetchRaw(imdbId: string, type: string, k: string): Promise<Raw> {
  const kind = type === 'movie' ? 'movie' : 'show';
  const res = await fetch(`https://api.mdblist.com/imdb/${kind}/${imdbId}?apikey=${encodeURIComponent(k)}`);
  if (res.ok) return (await res.json()) as Raw;
  if (res.status === 401) throw new Error('MDBList didn’t accept the API key');
  // Older endpoint, still widely used.
  const legacy = await fetch(`https://mdblist.com/api/?apikey=${encodeURIComponent(k)}&i=${imdbId}`);
  const body = (await legacy.json().catch(() => null)) as (Raw & { error?: string }) | null;
  if (!legacy.ok || !body || body.error) throw new Error(body?.error ?? `MDBList answered ${res.status}`);
  return body;
}

/** Checks the key against a known title, then saves it. Empty clears it. */
export async function setMdblistKey(value: string) {
  const v = value.trim();
  if (v) await fetchRaw('tt0133093', 'movie', v);
  key = v || null;
  await secureSet(KEY, key);
}

export async function getRatingSources(): Promise<RatingSourceId[]> {
  const raw = await AsyncStorage.getItem(SOURCES_KEY);
  return raw ? JSON.parse(raw) : ['imdb', 'tomatoes', 'audience', 'metacritic', 'letterboxd'];
}

export const setRatingSources = (ids: RatingSourceId[]) =>
  AsyncStorage.setItem(SOURCES_KEY, JSON.stringify(ids));

const cache = new Map<string, Promise<Rating[]>>();

/** Ratings for an IMDb id, in display order, only the sources you picked. */
export function getRatings(imdbId: string, type: string): Promise<Rating[]> {
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

async function load(imdbId: string, type: string): Promise<Rating[]> {
  const k = await getMdblistKey();
  if (!k || !/^tt\d+$/.test(imdbId)) return [];
  const [raw, wanted] = await Promise.all([fetchRaw(imdbId, type, k), getRatingSources()]);
  return RATING_SOURCES.filter((s) => wanted.includes(s.id)).flatMap<Rating>((s) => {
    const r = raw.ratings?.find((x) => x.source === s.id);
    if (!r || r.value == null || r.value === 0) return [];
    const value = s.max === 10 || s.max === 5 ? r.value.toFixed(1) : String(Math.round(r.value));
    return [
      {
        source: s.id,
        label: s.label,
        text: `${value}${'suffix' in s ? s.suffix : ''}`,
        votes: r.votes ?? undefined,
      },
    ];
  });
}
