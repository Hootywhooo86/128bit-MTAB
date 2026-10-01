/**
 * Download sources in Pageturner's JSON format (e.g. from pageturner-dsc.elfhosted.com).
 *
 * A source is a recipe, not a server: it says which URL to call with the book title,
 * where the results are in the JSON answer, and which fields hold the title, magnet,
 * info hash, size and seeders. 128bit runs the search itself and sends the torrent
 * you pick to TorBox.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '128bit.sources';

export type SourceConfig = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  icon?: string;
  /** "torrent" is supported; "directDownload" (HLS) isn't yet. */
  type: string;
  request: {
    method?: 'GET' | 'POST';
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeout?: number;
  };
  response: {
    type?: string;
    resultsPath?: string;
    mapping: Record<string, string | Record<string, string>>;
  };
  matching?: { field?: string; threshold?: number; algorithm?: string };
  legal?: { disclaimer?: string };
};

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
  if (!c.id || !c.name || !c.request?.url || !c.response?.mapping) {
    throw new Error("This doesn't look like a Pageturner download source");
  }
  if (c.type !== 'torrent') {
    throw new Error(
      `“${c.name}” is a ${c.type ?? 'unknown'} source. 128bit can use torrent sources (sent to TorBox) for now.`,
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
  return path.split('.').reduce<unknown>((o, k) => (o == null ? o : (o as any)[k]), obj);
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

export async function searchSource(source: SourceConfig, q: Query): Promise<SourceResult[]> {
  const { request, response, mapping } = { ...source, mapping: source.response.mapping };
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
    if (!Array.isArray(items)) return [];
    const field = (item: unknown, name: string) => {
      const path = mapping[name];
      return typeof path === 'string' ? at(item, path) : undefined;
    };
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
  } catch (e) {
    if (controller.signal.aborted) throw new Error('Timed out');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const resultHash = (r: SourceResult) =>
  r.infoHash ?? r.magnet?.match(/btih:([a-z0-9]+)/i)?.[1]?.toLowerCase();
