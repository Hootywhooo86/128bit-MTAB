/**
 * Audiobook search on Audible's public catalog: title, author, narrator or
 * everything, with cover, narrators, rating, length and series. Used for the
 * search bar in the Audiobooks tab (like Pageturner's search).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const API = 'https://api.audible.com/1.0/catalog/products';
const GROUPS = 'contributors,media,product_attrs,product_desc,rating,series';
const RECENT_KEY = '128bit.audiobookSearches';

export type SearchMode = 'title' | 'author' | 'narrator' | 'all';

export type AudibleBook = {
  asin: string;
  title: string;
  author?: string;
  narrator?: string;
  cover?: string;
  rating?: number;
  minutes?: number;
  /** "Ajax's Ascension, Book 1". */
  series?: string;
  description?: string;
  year?: string;
};

type Raw = {
  asin: string;
  title: string;
  subtitle?: string;
  authors?: { name: string }[];
  narrators?: { name: string }[];
  product_images?: Record<string, string>;
  rating?: { overall_distribution?: { display_average_rating?: string | number } };
  runtime_length_min?: number;
  series?: { title: string; sequence?: string }[];
  publisher_summary?: string;
  merchandising_summary?: string;
  release_date?: string;
};

function toBook(p: Raw): AudibleBook {
  const rating = Number(p.rating?.overall_distribution?.display_average_rating);
  const s = p.series?.[0];
  return {
    asin: p.asin,
    title: p.title,
    author: p.authors?.map((a) => a.name).join(', ') || undefined,
    narrator: p.narrators?.map((n) => n.name).join(', ') || undefined,
    cover: p.product_images?.['500'] ?? Object.values(p.product_images ?? {})[0],
    rating: rating > 0 ? rating : undefined,
    minutes: p.runtime_length_min || undefined,
    series: s ? `${s.title}${s.sequence ? `, Book ${s.sequence}` : ''}` : undefined,
    description: (p.publisher_summary ?? p.merchandising_summary)
      ?.replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    year: p.release_date?.slice(0, 4),
  };
}

export async function searchAudible(query: string, mode: SearchMode): Promise<AudibleBook[]> {
  const param = mode === 'all' ? 'keywords' : mode;
  const res = await fetch(
    `${API}?num_results=30&products_sort_by=Relevance&response_groups=${GROUPS}&${param}=${encodeURIComponent(query)}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`Audible search answered ${res.status}`);
  const data = (await res.json()) as { products?: Raw[] };
  return (data.products ?? []).filter((p) => p.title).map(toBook);
}

/** "16 hr 3 min". */
export function formatMinutes(min?: number) {
  if (!min) return undefined;
  const h = Math.floor(min / 60);
  return h ? `${h} hr ${min % 60} min` : `${min} min`;
}

// --- Recent searches ----------------------------------------------------------

export async function getRecentSearches(): Promise<string[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(RECENT_KEY)) ?? '[]');
  } catch {
    return [];
  }
}

export async function addRecentSearch(q: string) {
  const list = await getRecentSearches();
  const next = [q, ...list.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 12);
  await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}

export async function removeRecentSearch(q: string) {
  const next = (await getRecentSearches()).filter((x) => x !== q);
  await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}

export async function clearRecentSearches() {
  await AsyncStorage.setItem(RECENT_KEY, '[]');
  return [];
}
