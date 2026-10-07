import AsyncStorage from '@react-native-async-storage/async-storage';

import { getAddons, saveAddons } from './storage';
import type {
  BookDetail,
  BookPreview,
  CatalogDef,
  InstalledAddon,
  Manifest,
  MetaDetail,
  MetaPreview,
  Stream,
} from './types';

/** Safe metadata/subtitle addons (no streams), suggested in Addons. Not installed by themselves. */
export const DEFAULT_ADDONS = [
  {
    id: 'com.linvo.cinemeta',
    name: 'Cinemeta',
    description: 'Catalogs and details for movies and shows (the same one Stremio uses).',
    url: 'https://v3-cinemeta.strem.io/manifest.json',
  },
  {
    id: 'com.strem.kitsu',
    name: 'Kitsu',
    description: 'Anime catalogs, details and episodes (fills the Anime tab).',
    url: 'https://anime-kitsu.strem.fun/manifest.json',
  },
  {
    id: 'org.stremio.opensubtitlesv3',
    name: 'OpenSubtitles',
    description: 'Subtitles in many languages for movies and shows.',
    url: 'https://opensubtitles-v3.strem.io/manifest.json',
  },
];

const SEEDED_KEY = '128bit.starterAddons';
/**
 * The only addons a new install starts with: live TV / sports. Everything else is the
 * user's choice (suggested in Addons). Fill in once the sports addon links are picked.
 */
const STARTER_ADDONS: string[] = [];

/** First launch: install the starter addons (retried next launch if the phone was offline). */
export async function installDefaultAddons() {
  if (!STARTER_ADDONS.length || (await AsyncStorage.getItem(SEEDED_KEY))) return;
  const results = await Promise.allSettled(STARTER_ADDONS.map((url) => installAddon(url)));
  if (results.some((r) => r.status === 'fulfilled')) await AsyncStorage.setItem(SEEDED_KEY, '1');
}

/** Types shown in the Live TV tab. "tv"/"channel" are channels; the rest are sports and events. */
export const CHANNEL_TYPES = ['tv', 'channel'];
export const SPORT_TYPES = ['sport', 'sports', 'events', 'event', 'live'];
export const LIVE_TYPES = [...CHANNEL_TYPES, ...SPORT_TYPES];

export const SUPPORTED_TYPES = ['audiobook', 'movie', 'series', 'anime', ...LIVE_TYPES];

/** Shows and anime are the same kind of thing: an addon offering one usually serves the other. */
const EPISODIC = ['series', 'anime'];

/** Accepts `https://x/manifest.json`, `https://x/`, `stremio://x/manifest.json` or `128bit://…`. */
export function normalizeManifestUrl(input: string): string {
  let url = input.trim().replace(/^(128bit|stremio):\/\//i, 'https://');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/+$/, '');
  if (!url.endsWith('/manifest.json')) url += '/manifest.json';
  return url;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return (await res.json()) as T;
}

function validateManifest(m: Partial<Manifest>): Manifest {
  if (!m.id || !m.name || !m.version) throw new Error('Manifest is missing id, name or version');
  // Some addons (StremThru…) list their types only per resource and leave `types` empty.
  const types = [
    ...new Set([
      ...(Array.isArray(m.types) ? m.types : []),
      ...(m.resources ?? []).flatMap((r) => (typeof r === 'object' && r.types) || []),
    ]),
  ];
  if (!types.some((t) => SUPPORTED_TYPES.includes(t))) {
    throw new Error(
      `128bit doesn't know where to put this addon's content (type: ${types.join(', ') || 'none'}). ` +
        'It understands audiobook, movie, series, tv/channel and sport.',
    );
  }
  return {
    ...m,
    types,
    resources: m.resources ?? (types.includes('audiobook') ? ['catalog', 'book'] : []),
    catalogs: (m.catalogs ?? []).filter((c) => SUPPORTED_TYPES.includes(c.type)),
  } as Manifest;
}

export async function installAddon(input: string): Promise<InstalledAddon> {
  const manifestUrl = normalizeManifestUrl(input);
  const manifest = validateManifest(await getJson<Partial<Manifest>>(manifestUrl));
  const addon: InstalledAddon = {
    manifest,
    baseUrl: manifestUrl.replace(/\/manifest\.json$/, ''),
  };
  const addons = await getAddons();
  const existing = addons.findIndex((a) => a.manifest.id === manifest.id);
  if (existing >= 0) {
    // Reinstalling keeps its place and on/off state.
    addons[existing] = { ...addon, enabled: addons[existing].enabled };
    await saveAddons(addons);
  } else {
    await saveAddons([...addons, addon]);
  }
  return addon;
}

/** Re-downloads the manifest (picks up new catalogs or settings). */
export async function refreshAddon(id: string) {
  const addon = (await getAddons()).find((a) => a.manifest.id === id);
  if (addon) await installAddon(`${addon.baseUrl}/manifest.json`);
}

export async function setAddonEnabled(id: string, enabled: boolean) {
  const addons = await getAddons();
  await saveAddons(addons.map((a) => (a.manifest.id === id ? { ...a, enabled } : a)));
}

/** Moves an addon up (-1) or down (+1). Order decides which streams and catalogs come first. */
export async function moveAddon(id: string, delta: -1 | 1) {
  const addons = await getAddons();
  const i = addons.findIndex((a) => a.manifest.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= addons.length) return;
  [addons[i], addons[j]] = [addons[j], addons[i]];
  await saveAddons(addons);
}

export function resourceNames(addon: InstalledAddon) {
  return addon.manifest.resources.map((r) => (typeof r === 'string' ? r : r.name));
}

export async function uninstallAddon(id: string) {
  const addons = await getAddons();
  await saveAddons(addons.filter((a) => a.manifest.id !== id));
}

/** Does this addon offer `resource` for `type` (and, when given, for this item id)? */
export function supports(addon: InstalledAddon, resource: string, type: string, id?: string) {
  const { manifest } = addon;
  return manifest.resources.some((r) => {
    const name = typeof r === 'string' ? r : r.name;
    if (name !== resource) return false;
    const types = (typeof r === 'object' && r.types) || manifest.types;
    if (!types.includes(type)) return false;
    const prefixes = (typeof r === 'object' && r.idPrefixes) || manifest.idPrefixes;
    return !id || !prefixes?.length || prefixes.some((p) => id.startsWith(p));
  });
}

/** Anything anime: the word itself, anime services and anime databases. */
const ANIME =
  /anime|crunchy\s*roll|hidive|funimation|aniplex|animax|toonami|wakanim|animelab|ani-one|muse\s*asia|bilibili|vrv|kitsu|myanimelist|\bmal\b|anilist|anidb|aniwave|animeflv|gogoanime|9anime|zoro|hianime|simkl anime|anime-planet/i;

/**
 * Which tab a catalog belongs in. Addons often label anime as plain "series" or
 * "movie" (Kitsu rows, "Top Seeded Anime", Crunchyroll…), so names count too.
 */
export function catalogTab(addon: InstalledAddon, catalog: CatalogDef): string {
  if (catalog.type === 'anime') return 'anime';
  if (catalog.type !== 'series' && catalog.type !== 'movie') return catalog.type;
  // An anime addon (e.g. "Anime Kitsu"): all its show/movie catalogs are anime.
  const animeAddon = ANIME.test(`${addon.manifest.id} ${addon.manifest.name}`);
  if (ANIME.test(`${catalog.id} ${catalog.name ?? ''}`) || animeAddon) return 'anime';
  return catalog.type;
}

export function supportsSearch(catalog: CatalogDef) {
  return !!catalog.extra?.some((e) => e.name === 'search');
}

/** Catalogs shown by default: no required extras (except search-only catalogs, which are skipped). */
export function isBrowsable(catalog: CatalogDef) {
  return !catalog.extra?.some((e) => e.isRequired);
}

function extraPath(extra: Record<string, string | undefined>) {
  const parts = Object.entries(extra)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`);
  return parts.length ? `/${parts.join('&')}` : '';
}

// --- Audiobooks (128bit protocol) -------------------------------------------

export async function fetchCatalog(
  addon: InstalledAddon,
  catalog: CatalogDef,
  search?: string,
): Promise<BookPreview[]> {
  const data = await getJson<{ books?: BookPreview[] }>(
    `${addon.baseUrl}/catalog/audiobook/${encodeURIComponent(catalog.id)}${extraPath({ search })}.json`,
  );
  return data.books ?? [];
}

export async function fetchBook(addon: InstalledAddon, id: string): Promise<BookDetail> {
  const data = await getJson<{ book?: BookDetail }>(
    `${addon.baseUrl}/book/audiobook/${encodeURIComponent(id)}.json`,
  );
  if (!data.book) throw new Error('Addon returned no book');
  return { ...data.book, sources: data.book.sources ?? [] };
}

// --- Video (Stremio protocol) -----------------------------------------------

export async function fetchMetas(
  addon: InstalledAddon,
  catalog: CatalogDef,
  extra: { search?: string; genre?: string; skip?: string } = {},
): Promise<MetaPreview[]> {
  const data = await getJson<{ metas?: MetaPreview[] }>(
    `${addon.baseUrl}/catalog/${catalog.type}/${encodeURIComponent(catalog.id)}${extraPath(extra)}.json`,
  );
  return data.metas ?? [];
}

/** Asks each addon that can describe this item, preferring `preferred`, until one answers. */
export async function fetchMeta(
  addons: InstalledAddon[],
  type: string,
  id: string,
  preferred?: string,
): Promise<MetaDetail> {
  const candidates = addons
    .filter((a) => supports(a, 'meta', type, id))
    .sort((a, b) => Number(b.manifest.id === preferred) - Number(a.manifest.id === preferred));
  let lastError: unknown = new Error('None of your addons can show details for this title');
  for (const addon of candidates) {
    try {
      const data = await getJson<{ meta?: MetaDetail }>(
        `${addon.baseUrl}/meta/${type}/${encodeURIComponent(id)}.json`,
      );
      if (data.meta) return data.meta;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

export type AddonStreams = {
  addon: InstalledAddon;
  streams: Stream[];
  error?: string;
};

/** Streams from every addon that offers them for this item, fetched in parallel. */
const STREAM_TIMEOUT_MS = 15_000;
const STREAM_CACHE_MS = 10 * 60_000;
const streamCache = new Map<string, { at: number; groups: AddonStreams[] }>();

/** Addons that can give streams for this item, each with the type to ask it for. */
export function streamAddons(addons: InstalledAddon[], type: string, id: string) {
  // For anime and shows, ask each addon with whichever of the two types it supports.
  const typeFor = (a: InstalledAddon) =>
    supports(a, 'stream', type, id)
      ? type
      : EPISODIC.includes(type)
        ? EPISODIC.find((t) => supports(a, 'stream', t, id))
        : undefined;
  return addons.flatMap((addon) => {
    const t = typeFor(addon);
    return t ? [{ addon, type: t }] : [];
  });
}

async function fetchOne(addon: InstalledAddon, type: string, id: string): Promise<AddonStreams> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);
  try {
    const res = await fetch(`${addon.baseUrl}/stream/${type}/${encodeURIComponent(id)}.json`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = (await res.json()) as { streams?: Stream[] };
    return { addon, streams: data.streams ?? [] };
  } catch (e) {
    return {
      addon,
      streams: [],
      error: controller.signal.aborted ? 'Took too long to answer (skipped)' : e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Streams from every addon, delivered one addon at a time as each answers (a slow
 * addon no longer holds up the others; it gives up after 15 s). Results are kept
 * for 10 minutes, so going back to the same episode is instant.
 */
export function fetchStreamsEach(
  addons: InstalledAddon[],
  type: string,
  id: string,
  onAddon: (result: AddonStreams) => void,
  fresh = false,
): Promise<AddonStreams[]> {
  const key = `${type}:${id}:${addons.map((a) => a.manifest.id).join(',')}`;
  const hit = streamCache.get(key);
  if (hit && !fresh && Date.now() - hit.at < STREAM_CACHE_MS) {
    hit.groups.forEach(onAddon);
    return Promise.resolve(hit.groups);
  }
  return Promise.all(
    streamAddons(addons, type, id).map(({ addon, type: t }) =>
      fetchOne(addon, t, id).then((r) => {
        onAddon(r);
        return r;
      }),
    ),
  ).then((groups) => {
    if (groups.some((g) => g.streams.length)) streamCache.set(key, { at: Date.now(), groups });
    return groups;
  });
}

export async function fetchStreams(
  addons: InstalledAddon[],
  type: string,
  id: string,
): Promise<AddonStreams[]> {
  return fetchStreamsEach(addons, type, id, () => {});
}
