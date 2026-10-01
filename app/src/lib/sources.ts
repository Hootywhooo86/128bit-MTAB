/**
 * Sources in Pageturner's JSON format (e.g. from pageturner-dsc.elfhosted.com).
 *
 * Two kinds: catalogs (iTunes, Audible…) to find books, and download sources
 * (torrent indexes) to get them.
 *
 * A source is a recipe, not a server: it says which URL to call with the book title,
 * where the results are in the JSON answer, and which fields hold the title, magnet,
 * info hash, size and seeders. 128bit runs the search itself and sends the torrent
 * you pick to TorBox.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '128bit.sources';
const SEEDED_KEY = '128bit.defaultSourcesInstalled';

/** The owner's own source links, added on first launch (and offered again in Settings if removed). */
export const DEFAULT_SOURCES = [
  { name: 'iTunes Audiobooks', url: 'https://www.jsonkeeper.com/b/KUYNU' },
  { name: 'Audible (Enhanced)', url: 'https://www.jsonkeeper.com/b/EDF2N' },
  { name: 'iTunes Audiolibri (IT)', url: 'https://www.jsonkeeper.com/b/VUONU' },
  { name: 'The Pirate Bay', url: 'https://www.jsonkeeper.com/b/JYB6Z' },
  { name: 'AudiobookBay', url: 'https://jsonkeeper.com/b/UKNXL' },
];

/** Runs once; if the phone is offline it tries again next launch. */
export async function installDefaultSources() {
  if (await AsyncStorage.getItem(SEEDED_KEY)) return;
  const installed = await getSources();
  const results = [];
  // One at a time: each install rewrites the saved list.
  for (const d of DEFAULT_SOURCES) {
    if (installed.some((s) => s.url === d.url)) continue;
    results.push(await installSource(d.url).then(() => true, () => false));
  }
  if (results.length === 0 || results.some(Boolean)) await AsyncStorage.setItem(SEEDED_KEY, '1');
}

type Request = {
  method?: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
};

type Response = {
  type?: string;
  resultsPath?: string;
  mapping: Record<string, string | Record<string, string>>;
};

export type DiscoverSection = {
  id: string;
  title: string;
  request: Request;
  /** Missing = same shape as the search response. */
  response?: Response;
};

export type SourceConfig = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  icon?: string;
  /** Download sources: "torrent" is supported; "directDownload" (HLS) isn't yet. */
  type?: string;
  /** Download sources. */
  request?: Request;
  response?: Response;
  matching?: { field?: string; threshold?: number; algorithm?: string };
  legal?: { disclaimer?: string };
  /** Catalog sources (iTunes, Audible…): find books, but don't download them. */
  capabilities?: { search?: boolean; discover?: boolean };
  search?: { request: Request; response: Response };
  discover?: { sections: DiscoverSection[] };
};

/** A book from a catalog source. Tap it to look for it in your download sources. */
export type CatalogBook = {
  id: string;
  title: string;
  author?: string;
  narrator?: string;
  cover?: string;
  description?: string;
  year?: string;
  genre?: string;
  /** Minutes. */
  minutes?: number;
  series?: string;
};

export const isCatalog = (c: SourceConfig) => !!c.search?.request;

export type InstalledSource = { url: string; config: SourceConfig; enabled?: boolean };

export type SourceResult = {
  sourceId: string;
  sourceName: string;
  title: string;
  magnet?: string;
  infoHash?: string;
  size?: number;
  seeders?: number;
  leechers?: number;
  format?: string;
  /** Uploader or author, depending on the source. */
  by?: string;
  date?: string;
  score: number;
};

// --- Installed list ---------------------------------------------------------

export async function getSources(): Promise<InstalledSource[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]');
  } catch {
    return [];
  }
}

const saveSources = (list: InstalledSource[]) => AsyncStorage.setItem(KEY, JSON.stringify(list));

function validate(c: Partial<SourceConfig>): SourceConfig {
  if (!c.id || !c.name) throw new Error("This doesn't look like a Pageturner source");
  if (c.search?.request?.url && c.search.response?.mapping) return c as SourceConfig;
  if (!c.request?.url || !c.response?.mapping) {
    throw new Error("This doesn't look like a Pageturner source");
  }
  if (c.type !== 'torrent') {
    throw new Error(
      `“${c.name}” is a ${c.type ?? 'unknown'} source. 128bit can use torrent sources (sent to TorBox) and book catalogs for now.`,
    );
  }
  if (c.response.type && c.response.type !== 'json') {
    throw new Error(`“${c.name}” answers in ${c.response.type}; only JSON sources work.`);
  }
  return c as SourceConfig;
}

export async function installSource(input: string): Promise<InstalledSource> {
  const url = input.trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('Paste the full source URL (https://…)');
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const config = validate(await res.json());
  const list = await getSources();
  const existing = list.findIndex((s) => s.config.id === config.id);
  const source: InstalledSource = {
    url,
    config,
    enabled: existing >= 0 ? list[existing].enabled : true,
  };
  if (existing >= 0) list[existing] = source;
  else list.push(source);
  await saveSources(list);
  return source;
}

export async function removeSource(id: string) {
  await saveSources((await getSources()).filter((s) => s.config.id !== id));
}

export async function setSourceEnabled(id: string, enabled: boolean) {
  await saveSources(
    (await getSources()).map((s) => (s.config.id === id ? { ...s, enabled } : s)),
  );
}

// --- Searching --------------------------------------------------------------

type Query = { title: string; author?: string; narrator?: string };

function fill(template: string, q: Query, encode: boolean) {
  const value = (v?: string) => (encode ? encodeURIComponent(v ?? '') : (v ?? ''));
  return template
    .replace(/\{TITLE\}/g, value(q.title))
    .replace(/\{AUTHOR\}/g, value(q.author))
    .replace(/\{NARRATOR\}/g, value(q.narrator))
    .replace(/\{QUERY\}/g, value([q.title, q.author].filter(Boolean).join(' ')));
}

function fillBody(body: unknown, q: Query): unknown {
  if (typeof body === 'string') return fill(body, q, false);
  if (Array.isArray(body)) return body.map((b) => fillBody(b, q));
  if (body && typeof body === 'object') {
    return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, fillBody(v, q)]));
  }
  return body;
}

/** "a.b.0.c" from an object; "" is the object itself. */
function at(obj: unknown, path?: string): unknown {
  if (!path) return obj;
  // "authors[0].name" works too.
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.').reduce<unknown>((o, k) => (o == null ? o : (o as any)[k]), obj);
}

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : undefined;
};

const str = (v: unknown) => (v == null || v === '' ? undefined : String(v));

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((w) => w.length > 1 && !['the', 'and', 'of', 'a'].includes(w));

/** Share of the search words that appear in the result title (0..1). */
export function matchScore(query: string, title: string) {
  const want = words(query);
  if (!want.length) return 1;
  const have = new Set(words(title));
  return want.filter((w) => have.has(w)).length / want.length;
}

/** Calls a source's request with the query filled in and returns its result items. */
async function run(request: Request, response: Response, q: Query): Promise<unknown[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeout ?? 20_000);
  try {
    const method = request.method ?? 'GET';
    const res = await fetch(fill(request.url, q, true), {
      method,
      headers: { Accept: 'application/json', ...request.headers },
      body: method === 'POST' && request.body ? JSON.stringify(fillBody(request.body, q)) : undefined,
      signal: controller.signal,
    });
    if (res.status === 429) throw new Error('Too many searches, wait a minute');
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
    }
    const items = at(await res.json(), response.resultsPath);
    return Array.isArray(items) ? items : [];
  } catch (e) {
    if (controller.signal.aborted) throw new Error('Timed out');
    if (e instanceof TypeError) throw new Error("Couldn't reach it");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const mapper = (response: Response) => (item: unknown, name: string) => {
  const path = response.mapping[name];
  return typeof path === 'string' ? at(item, path) : undefined;
};

export async function searchSource(source: SourceConfig, q: Query): Promise<SourceResult[]> {
  if (!source.request || !source.response) return [];
  const field = mapper(source.response);
  const items = await run(source.request, source.response, q);
  const threshold = source.matching?.threshold ?? 0.4;
  return items
    .map<SourceResult>((item) => {
      const title = str(field(item, 'title')) ?? 'Untitled';
      let infoHash = str(field(item, 'infoHash'))?.toLowerCase();
      if (infoHash && /^0+$/.test(infoHash)) infoHash = undefined; // "no results" placeholder
      return {
        sourceId: source.id,
        sourceName: source.name,
        title,
        magnet: str(field(item, 'magnetUrl')),
        infoHash,
        size: num(field(item, 'size')),
        seeders: num(field(item, 'seeders')),
        leechers: num(field(item, 'leechers')),
        format: str(field(item, 'format')),
        by: str(field(item, 'source')),
        date: str(field(item, 'date')),
        score: matchScore(q.title, title),
      };
    })
    .filter((r) => (r.magnet || r.infoHash) && r.score >= threshold);
}

// --- Catalogs ---------------------------------------------------------------

/** "Project Hail Mary (Unabridged)" → "Project Hail Mary": better for torrent searches. */
export const cleanTitle = (title: string) =>
  title
    .replace(/\s*[([](un)?abridged[)\]]\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** iTunes gives 100px artwork; ask for a bigger one. */
const bigCover = (url?: string) => url?.replace(/\/\d+x\d+bb\./, '/600x600bb.');

function toBooks(source: SourceConfig, response: Response, items: unknown[]): CatalogBook[] {
  const field = mapper(response);
  const minutesOf = (v: unknown) => {
    const n = num(v);
    if (!n) return undefined;
    return response.mapping.durationUnit === 'seconds' ? n / 60 : n;
  };
  return items
    .map((item, i) => {
      const title = str(field(item, 'title'));
      if (!title) return null;
      return {
        id: `${source.id}:${str(field(item, 'isbn')) ?? `${i}:${title}`}`,
        title,
        author: str(field(item, 'author')),
        narrator: str(field(item, 'narrator')),
        cover: bigCover(str(field(item, 'cover'))),
        description: str(field(item, 'description'))?.replace(/<[^>]+>/g, ''),
        year: str(field(item, 'publishedYear'))?.slice(0, 4),
        genre: str(field(item, 'genres')),
        minutes: minutesOf(field(item, 'duration')),
        series: str(field(item, 'seriesName')),
      };
    })
    .filter(Boolean) as CatalogBook[];
}

export async function searchCatalog(source: SourceConfig, query: string): Promise<CatalogBook[]> {
  if (!source.search) return [];
  const { request, response } = source.search;
  return toBooks(source, response, await run(request, response, { title: query }));
}

export async function discoverSection(
  source: SourceConfig,
  section: DiscoverSection,
): Promise<CatalogBook[]> {
  const response = section.response ?? source.search?.response;
  if (!response) return [];
  return toBooks(source, response, await run(section.request, response, { title: '' }));
}

export const resultHash = (r: SourceResult) =>
  r.infoHash ?? r.magnet?.match(/btih:([a-z0-9]+)/i)?.[1]?.toLowerCase();
