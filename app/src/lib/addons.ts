import { getAddons, saveAddons } from './storage';
import type { BookDetail, BookPreview, CatalogDef, InstalledAddon, Manifest } from './types';

/** Accepts `https://x/manifest.json`, `https://x/` or `stremio://`-style `128bit://x/manifest.json`. */
export function normalizeManifestUrl(input: string): string {
  let url = input.trim().replace(/^128bit:\/\//i, 'https://');
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
  if (!Array.isArray(m.types) || !m.types.includes('audiobook')) {
    throw new Error('This addon does not provide audiobooks (types must include "audiobook")');
  }
  return {
    ...m,
    resources: m.resources ?? ['catalog', 'book'],
    catalogs: (m.catalogs ?? []).filter((c) => c.type === 'audiobook'),
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

export function supportsSearch(catalog: CatalogDef) {
  return !!catalog.extra?.some((e) => e.name === 'search');
}

export async function fetchCatalog(
  addon: InstalledAddon,
  catalog: CatalogDef,
  search?: string,
): Promise<BookPreview[]> {
  const extra = search ? `/search=${encodeURIComponent(search)}` : '';
  const data = await getJson<{ books?: BookPreview[] }>(
    `${addon.baseUrl}/catalog/audiobook/${encodeURIComponent(catalog.id)}${extra}.json`,
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
