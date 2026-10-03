/**
 * Skip intro: where the opening (and recap) is in an episode.
 * - Anime: AniSkip (api.aniskip.com), by MyAnimeList id; ani.zip maps Kitsu / AniList /
 *   IMDb ids to MAL.
 * - Shows: IntroDB (api.introdb.app), by IMDb id + season + episode.
 * Nothing found → the player offers a manual "+85 s" in the first few minutes instead.
 */

export type Segment = { kind: 'intro' | 'recap' | 'outro'; start: number; end: number };

const cache = new Map<string, Segment[]>();

async function json<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

type AniZip = {
  mappings?: { mal_id?: number };
  episodes?: Record<string, { seasonNumber?: number; episodeNumber?: number; episode?: string }>;
};

async function aniSkip(malId: number, episode: number, length: number): Promise<Segment[]> {
  type R = { found: boolean; results?: { skipType: string; interval: { startTime: number; endTime: number } }[] };
  const r = await json<R>(
    `https://api.aniskip.com/v2/skip-times/${malId}/${episode}?types=op&types=ed&types=recap&episodeLength=${Math.round(length)}`,
  );
  return (r?.results ?? []).map((x) => ({
    kind: x.skipType === 'op' ? 'intro' : x.skipType === 'ed' ? 'outro' : 'recap',
    start: x.interval.startTime,
    end: x.interval.endTime,
  }));
}

async function introDb(imdb: string, season: number, episode: number): Promise<Segment[]> {
  type Part = { start_sec: number; end_sec: number } | null;
  const r = await json<{ intro?: Part; recap?: Part; outro?: Part }>(
    `https://api.introdb.app/segments?imdb_id=${imdb}&season=${season}&episode=${episode}`,
  );
  if (!r) return [];
  return (['intro', 'recap', 'outro'] as const).flatMap((kind) => {
    const p = r[kind];
    return p && p.end_sec > p.start_sec ? [{ kind, start: p.start_sec, end: p.end_sec }] : [];
  });
}

/** MAL id + episode number for an addon episode id (kitsu:/mal:/anilist:/IMDb). */
async function malFor(key: string): Promise<{ mal: number; episode: number } | null> {
  const [site, id, a] = key.split(':');
  if (site === 'mal') return { mal: Number(id), episode: Number(a) || 1 };
  if (site === 'kitsu' || site === 'anilist') {
    const z = await json<AniZip>(`https://api.ani.zip/mappings?${site}_id=${id}`);
    return z?.mappings?.mal_id ? { mal: z.mappings.mal_id, episode: Number(a) || 1 } : null;
  }
  if (/^tt\d+$/.test(site)) {
    // IMDb season/episode → the MAL entry's own episode number, when ani.zip knows it.
    const season = Number(id);
    const ep = Number(a);
    const z = await json<AniZip>(`https://api.ani.zip/mappings?imdb_id=${site}`);
    if (!z?.mappings?.mal_id) return null;
    const hit = Object.values(z.episodes ?? {}).find((e) => e.seasonNumber === season && e.episodeNumber === ep);
    const n = Number(hit?.episode);
    return { mal: z.mappings.mal_id, episode: n > 0 ? n : ep };
  }
  return null;
}

/** The skippable parts of one episode (empty when nobody has marked them). */
export async function getSegments(key: string, anime: boolean, length: number): Promise<Segment[]> {
  const hit = cache.get(key);
  if (hit) return hit;
  let found: Segment[] = [];
  const [imdb, season, episode] = key.split(':');
  if (/^tt\d+$/.test(imdb) && season && episode) {
    found = await introDb(imdb, Number(season), Number(episode));
  }
  if (!found.some((s) => s.kind === 'intro') && (anime || !/^tt/.test(key))) {
    const m = await malFor(key);
    if (m) found = [...found.filter((s) => s.kind !== 'intro'), ...(await aniSkip(m.mal, m.episode, length))];
  }
  cache.set(key, found);
  return found;
}

/** How far the manual skip jumps when no intro is known (a typical opening). */
export const MANUAL_SKIP_S = 85;
/** The manual skip is offered only at the start of an episode. */
export const MANUAL_WINDOW_S = 300;
