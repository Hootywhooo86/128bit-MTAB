/**
 * Anime search straight from Kitsu (kitsu.io, no key). The "Anime Kitsu" addon's own
 * search often returns only a handful of titles; Kitsu itself finds many more. Results
 * use the same ids as the addon (`kitsu:<id>`), so tapping one opens the same title
 * page, details and streams.
 */
import { supports } from './addons';
import type { InstalledAddon, MetaDetail, MetaPreview } from './types';

type KitsuAnime = {
  id: string;
  attributes: {
    canonicalTitle?: string;
    titles?: Record<string, string | undefined>;
    subtype?: string;
    startDate?: string | null;
    synopsis?: string;
    averageRating?: string | null;
    posterImage?: { medium?: string; small?: string; large?: string } | null;
    coverImage?: { large?: string; original?: string } | null;
  };
};

/**
 * The type an installed addon serves Kitsu details under: movies as "movie", the rest as
 * "series" — or "anime" when that's the only type an addon offers for `kitsu:` ids.
 */
function typeFor(addons: InstalledAddon[], movie: boolean) {
  const can = (t: string) => addons.some((a) => supports(a, 'meta', t, 'kitsu:1'));
  if (movie && can('movie')) return 'movie';
  if (can('series')) return 'series';
  if (can('anime')) return 'anime';
  return movie ? 'movie' : 'series';
}

export async function searchKitsu(query: string, addons: InstalledAddon[]): Promise<MetaPreview[]> {
  const url = `https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(query)}&page[limit]=20`;
  const res = await fetch(url, { headers: { Accept: 'application/vnd.api+json' } });
  if (!res.ok) throw new Error(`Kitsu: ${res.status}`);
  const { data } = (await res.json()) as { data?: KitsuAnime[] };
  return (data ?? []).map(({ id, attributes: a }) => ({
    id: `kitsu:${id}`,
    type: typeFor(addons, a.subtype === 'movie'),
    name: a.canonicalTitle ?? a.titles?.en ?? a.titles?.en_jp ?? 'Anime',
    poster: a.posterImage?.medium ?? a.posterImage?.small ?? a.posterImage?.large,
    background: a.coverImage?.large ?? a.coverImage?.original,
    description: a.synopsis,
    releaseInfo: a.startDate ? a.startDate.slice(0, 4) : undefined,
    imdbRating: a.averageRating ? (Number(a.averageRating) / 10).toFixed(1) : undefined,
  }));
}

/** Details straight from Kitsu, for when no addon can show this `kitsu:` title. */
export async function kitsuMeta(id: string): Promise<MetaDetail> {
  const n = id.match(/^kitsu:(\d+)/)?.[1];
  if (!n) throw new Error('Not a Kitsu title');
  const res = await fetch(`https://kitsu.io/api/edge/anime/${n}`, { headers: { Accept: 'application/vnd.api+json' } });
  if (!res.ok) throw new Error(`Kitsu: ${res.status}`);
  const { data } = (await res.json()) as { data: KitsuAnime };
  const a = data.attributes;
  return {
    id: `kitsu:${n}`,
    type: a.subtype === 'movie' ? 'movie' : 'series',
    name: a.canonicalTitle ?? a.titles?.en ?? a.titles?.en_jp ?? 'Anime',
    poster: a.posterImage?.medium ?? a.posterImage?.large,
    background: a.coverImage?.large ?? a.coverImage?.original,
    description: a.synopsis,
    releaseInfo: a.startDate ? a.startDate.slice(0, 4) : undefined,
  };
}
