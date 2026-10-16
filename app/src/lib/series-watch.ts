/**
 * "Watch my series": once a day, look up the series of the books on Wanted and in the library
 * on Audible's catalog, and put newly released later books on Wanted. A series set to
 * "download when ready" also gets the new book sent off right away. Idea from Listenarr.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { readPrefs } from './prefs';
import { dayKey } from './stats';
import { getLibrary } from './storage';
import { addWanted, getWanted, grabBook, wantedId } from './wanted';

const API = 'https://api.audible.com/1.0/catalog/products';
const LAST_KEY = '128bit.seriesWatch.last';
/** Book (title|author) → its series on Audible, or null when it isn't in one. */
const SEEN_KEY = '128bit.seriesWatch.books';
const DAY = 24 * 3600_000;

type Series = { asin: string; seq: number } | null;
type Product = {
  asin: string;
  title: string;
  authors?: { name: string }[];
  product_images?: Record<string, string>;
  release_date?: string;
  series?: { asin: string; title: string; sequence?: string }[];
};

const get = async <T>(url: string) => {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Audible answered ${res.status}`);
  return (await res.json()) as T;
};

async function seriesOf(title: string, author?: string): Promise<Series> {
  const q = `title=${encodeURIComponent(title)}${author ? `&author=${encodeURIComponent(author)}` : ''}`;
  const { products } = await get<{ products?: Product[] }>(`${API}?num_results=1&response_groups=series&${q}`);
  const s = products?.[0]?.series?.[0];
  const seq = Number(s?.sequence);
  return s && seq ? { asin: s.asin, seq } : null;
}

let running = false;

export async function watchSeries(force = false) {
  if (running || !(await readPrefs()).watchSeries) return;
  if (!force && Date.now() - Number(await AsyncStorage.getItem(LAST_KEY)) < DAY) return;
  running = true;
  try {
    const wanted = await getWanted();
    const books = [...wanted, ...(await getLibrary())];
    const seen: Record<string, Series> = JSON.parse((await AsyncStorage.getItem(SEEN_KEY)) ?? '{}');
    // Highest book you have/want per series, and whether that series auto-downloads.
    const series = new Map<string, { seq: number; auto: boolean }>();
    for (const b of books.slice(0, 60)) {
      const key = wantedId(b.title, b.author);
      if (!(key in seen)) seen[key] = await seriesOf(b.title, b.author).catch(() => null);
      const s = seen[key];
      if (!s) continue;
      const cur = series.get(s.asin);
      const auto = !!wanted.find((w) => w.id === key)?.autoDownload;
      series.set(s.asin, { seq: Math.max(cur?.seq ?? 0, s.seq), auto: !!cur?.auto || auto });
    }
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(seen));

    const today = dayKey(); // local day, not UTC's
    for (const [asin, { seq, auto }] of series) {
      const { product } = await get<{ product: { relationships?: { asin: string; sequence?: string }[] } }>(
        `${API}/${asin}?response_groups=relationships`,
      ).catch(() => ({ product: {} as { relationships?: { asin: string; sequence?: string }[] } }));
      const later = (product.relationships ?? []).filter((r) => Number(r.sequence) > seq).map((r) => r.asin);
      if (!later.length) continue;
      const { products = [] } = await get<{ products?: Product[] }>(
        `${API}?asins=${later.join(',')}&response_groups=product_attrs,contributors,media,series`,
      ).catch(() => ({ products: [] as Product[] }));
      for (const p of products) {
        if (!p.release_date || p.release_date > today) continue; // not out yet
        const author = p.authors?.map((a) => a.name).join(', ');
        const s = p.series?.[0];
        const book = {
          title: p.title,
          author,
          cover: p.product_images?.['500'] ?? Object.values(p.product_images ?? {})[0],
          series: s ? `${s.title}${s.sequence ? `, Book ${s.sequence}` : ''}` : undefined,
          autoDownload: auto || undefined,
        };
        // A series you auto-download: find it and send it right away (it stays wanted if not found).
        if (auto) await grabBook(book).catch(() => {});
        else await addWanted(book);
        seen[wantedId(p.title, author)] = s ? { asin: s.asin, seq: Number(s.sequence) || 0 } : null;
      }
    }
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(seen));
    await AsyncStorage.setItem(LAST_KEY, String(Date.now()));
  } finally {
    running = false;
  }
}
