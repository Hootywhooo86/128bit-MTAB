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

/** Safe metadata/subtitle addons (no streams). Installed on first launch, and suggested in Addons. */
export const DEFAULT_ADDONS = [
  {
    id: 'com.linvo.cinemeta',
    name: 'Cinemeta',
    description: 'Catalogs and details for movies and shows (the same one Stremio uses).',
    url: 'https://v3-cinemeta.strem.io/manifest.json',
  },
  {
    id: 'org.stremio.opensubtitlesv3',
    name: 'OpenSubtitles',
    description: 'Subtitles in many languages for movies and shows.',
    url: 'https://opensubtitles-v3.strem.io/manifest.json',
  },
];

const SEEDED_KEY = '128bit.defaultsInstalled';

/**
 * On the very first launch, install the default addons so Home isn't empty.
 * Runs once; if the phone is offline it tries again next launch.
 */
export async function installDefaultAddons() {
  if (await AsyncStorage.getItem(SEEDED_KEY)) return;
  const results = await Promise.allSettled(DEFAULT_ADDONS.map((a) => installAddon(a.url)));
  if (results.some((r) => r.status === 'fulfilled')) await AsyncStorage.setItem(SEEDED_KEY, '1');
}

/** Types shown in the Live TV tab. "tv"/"channel" are channels; the rest are sports and events. */
export const CHANNEL_TYPES = ['tv', 'channel'];
export const SPORT_TYPES = ['sport', 'sports', 'events', 'event', 'live'];
export const LIVE_TYPES = [...CHANNEL_TYPES, ...SPORT_TYPES];

export const SUPPORTED_TYPES = ['audiobook', 'movie', 'series', ...LIVE_TYPES];

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
  const types = Array.isArray(m.types) ? m.types : [];
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
export async function fetchStreams(
  addons: InstalledAddon[],
  type: string,
  id: string,
): Promise<AddonStreams[]> {
  const candidates = addons.filter((a) => supports(a, 'stream', type, id));
  return Promise.all(
    candidates.map(async (addon) => {
      try {
        const data = await getJson<{ streams?: Stream[] }>(
          `${addon.baseUrl}/stream/${type}/${encodeURIComponent(id)}.json`,
        );
        return { addon, streams: data.streams ?? [] };
      } catch (e) {
        return {
          addon,
          streams: [],
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );
}
