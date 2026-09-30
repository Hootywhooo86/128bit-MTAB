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

export const SUPPORTED_TYPES = ['audiobook', 'movie', 'series', 'tv'];

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
    throw new Error('This addon has nothing 128bit can use (no audiobook, movie, series or tv type)');
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
  const addon: InstalledAddon = { manifest, baseUrl: manifestUrl.replace(/\/manifest\.json$/, '') };
  const addons = await getAddons();
  await saveAddons([...addons.filter((a) => a.manifest.id !== manifest.id), addon]);
  return addon;
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

export type AddonStreams = { addon: InstalledAddon; streams: Stream[]; error?: string };

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
        return { addon, streams: [], error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
}
