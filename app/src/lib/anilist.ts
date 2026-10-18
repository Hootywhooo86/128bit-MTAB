/**
 * Anime search straight from AniList (graphql.anilist.co, no key). Only used when an
 * installed addon can show AniList or MyAnimeList ids (AIOMetadata etc.): results use
 * those ids (`anilist:<id>` / `mal:<id>`), so tapping one opens that addon's title page.
 */
import { supports } from './addons';
import type { InstalledAddon, MetaPreview } from './types';

type Media = {
  id: number;
  idMal?: number | null;
  format?: string | null;
  title?: { english?: string | null; romaji?: string | null } | null;
  coverImage?: { large?: string | null; medium?: string | null } | null;
  bannerImage?: string | null;
  startDate?: { year?: number | null } | null;
  averageScore?: number | null;
  genres?: string[] | null;
};

const QUERY = `query ($q: String) { Page(perPage: 20) { media(search: $q, type: ANIME, isAdult: false) {
  id idMal format title { english romaji } coverImage { large medium } bannerImage startDate { year } averageScore genres
} } }`;

/** Which id an addon can open for this title, and under which type; null when none can. */
function openable(addons: InstalledAddon[], m: Media) {
  const types = m.format === 'MOVIE' ? ['movie', 'series', 'anime'] : ['series', 'anime'];
  for (const id of [`anilist:${m.id}`, m.idMal ? `mal:${m.idMal}` : null]) {
    if (!id) continue;
    const type = types.find((t) => addons.some((a) => !a.place && supports(a, 'meta', t, id)));
    if (type) return { id, type };
  }
  return null;
}

/** Whether any installed addon can open AniList / MAL ids (else this search is skipped). */
export function canOpenAnilist(addons: InstalledAddon[]) {
  return addons.some(
    (a) => !a.place && ['series', 'anime', 'movie'].some((t) => supports(a, 'meta', t, 'anilist:1') || supports(a, 'meta', t, 'mal:1')),
  );
}

export async function searchAnilist(query: string, addons: InstalledAddon[]): Promise<MetaPreview[]> {
  if (!canOpenAnilist(addons)) return [];
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { q: query } }),
  });
  if (!res.ok) throw new Error(`AniList: ${res.status}`);
  const body = (await res.json()) as { data?: { Page?: { media?: Media[] } } };
  const out: MetaPreview[] = [];
  for (const m of body.data?.Page?.media ?? []) {
    const open = openable(addons, m);
    if (!open) continue;
    out.push({
      id: open.id,
      type: open.type,
      name: m.title?.english ?? m.title?.romaji ?? 'Anime',
      poster: m.coverImage?.large ?? m.coverImage?.medium ?? undefined,
      background: m.bannerImage ?? undefined,
      releaseInfo: m.startDate?.year ? String(m.startDate.year) : undefined,
      imdbRating: m.averageScore ? (m.averageScore / 10).toFixed(1) : undefined,
      genres: m.genres ?? undefined,
    });
  }
  return out;
}
