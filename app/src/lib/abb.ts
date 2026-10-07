/**
 * AudiobookBay search: reads the site's own search pages (/page/N/?s=…), the way
 * audiobookbay-automated (github.com/JamesRy96/audiobookbay-automated, MIT) does.
 * The torrent for a result comes from its post page (see resolveTorrent in feeds.ts).
 */
import { decodeEntities, type FeedItem } from './feeds';
import { matchScore } from './sources';

export const ABB_HOST = 'audiobookbay.lu';
/** Other addresses AudiobookBay uses, tried when the main one can't be reached. */
const MIRRORS = [ABB_HOST, 'audiobookbay.is', 'audiobookbay.fi'];
let workingHost = ABB_HOST;

export type AbbResult = FeedItem & {
  link: string;
  cover?: string;
  language?: string;
  category?: string;
  posted?: string;
  sizeText?: string;
  score: number;
};

const text = (html?: string) =>
  html ? decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : undefined;

/** A request that gives up after `ms` (a slow site must never hang the search). */
async function fetchWithTimeout(url: string, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (e) {
    throw controller.signal.aborted ? new Error('AudiobookBay is slow to answer right now') : e;
  } finally {
    clearTimeout(timer);
  }
}

/** Set when AudiobookBay just failed us, so the rest of that search stops waiting on it. */
let downUntil = 0;

/** "Try again": ask AudiobookBay straight away, even if it just failed. */
export const retryAbbNow = () => {
  downUntil = 0;
};

/**
 * The main address, then the mirrors only if it can't be reached at all (a blocked or
 * unknown address fails fast). A slow answer just times out: the mirrors are the same site.
 */
async function fetchMirror(path: string) {
  if (Date.now() < downUntil) throw new Error('AudiobookBay is slow to answer right now.');
  let last: unknown;
  for (const host of [workingHost, ...MIRRORS.filter((h) => h !== workingHost)]) {
    try {
      const res = await fetchWithTimeout(`https://${host}${path}`, 7000);
      if (res.status >= 500 && res.status !== 503) throw new Error(`AudiobookBay answered ${res.status}`);
      workingHost = host;
      return res;
    } catch (e) {
      last = e;
      if (e instanceof Error && /slow to answer/.test(e.message)) break;
    }
  }
  downUntil = Date.now() + 20_000;
  throw last instanceof Error ? last : new Error('Couldn’t reach AudiobookBay');
}

/** One page of results (about 9). `more` is true when there's probably another page. */
export async function searchAbb(
  query: string,
  page = 1,
): Promise<{ results: AbbResult[]; more: boolean }> {
  const q = encodeURIComponent(query.trim().toLowerCase()).replace(/%20/g, '+');
  const res = await fetchMirror(`/page/${page}/?s=${q}`);
  // Past the last page the site answers 404.
  if (res.status === 404) return { results: [], more: false };
  if (!res.ok) throw new Error(`AudiobookBay answered ${res.status}`);
  const html = await res.text();
  const posts = html.split(/<div class="post">/).slice(1);
  const results = posts.flatMap<AbbResult>((post) => {
    const a = post.match(/class="postTitle"><h2><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) return [];
    const href = a[1].startsWith('http') ? a[1] : `https://${workingHost}${a[1]}`;
    const title = text(a[2]) ?? 'Untitled';
    const info = text(post.match(/class="postInfo">([\s\S]*?)<\/div>/)?.[1]) ?? '';
    const details = post.match(/text-align:center;'>([\s\S]*?)<\/p>/)?.[1] ?? '';
    const field = (name: string, unit = false) => {
      const m = details.match(new RegExp(`${name}:\\s*<span[^>]*>([^<]+)</span>\\s*([^<]*)`));
      const value = text(unit ? `${m?.[1]} ${m?.[2]}` : m?.[1]);
      return value && value !== '?' && m ? value : undefined;
    };
    const [name, author] = title.split(/\s+-\s+(?=[^-]+$)/);
    return [
      {
        title,
        link: href,
        author: author ? author.trim() : undefined,
        cover: post.match(/<img[^>]+src="(https?:[^"]+)"/)?.[1],
        sharedBy: text(post.match(/Shared by:([\s\S]*?)<\/p>/)?.[1]),
        language: info.match(/Language:\s*(\S+)/)?.[1],
        category: info.match(/Category:\s*(.*?)\s*Language:/)?.[1]?.replace(/\s+/g, ' '),
        posted: text(details.match(/Posted:\s*([^<]+)/)?.[1]),
        format: field('Format'),
        bitrate: field('Bitrate'),
        sizeText: field('File Size', true),
        score: matchScore(query, name ?? title),
      },
    ];
  });
  return { results, more: posts.length >= 9 };
}

// --- Smart search ---------------------------------------------------------------------
//
// AudiobookBay's own search is very literal: the full title "The Delves: Book 5 of Ajax's
// Ascension" finds nothing, "the delves" drowns in other books ("the" matches everything),
// and "ajaxs" without the apostrophe finds nothing. So we ask it several simpler questions
// (the key words, the series, the author, the most distinctive words) and merge the answers,
// best match first.

const NOISE = new Set([
  'the', 'a', 'an', 'of', 'and', 'in', 'on', 'to', 'for', 'by', 'at', 'from', 'with',
  'book', 'books', 'vol', 'volume', 'part', 'audiobook', 'audiobooks', 'audio', 'm4b', 'mp3',
  'unabridged', 'abridged', 'series', 'edition', 'novel',
]);

/** Lower-case words, curly apostrophes made straight, punctuation dropped (apostrophes kept). */
function wordsOf(s: string) {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc`]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .split(' ')
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

const keyWords = (s: string) => wordsOf(s).filter((w) => !NOISE.has(w) && !/^\d+$/.test(w) && w.length > 1);

/** The questions to ask AudiobookBay for one search, most specific first (at most 5). */
export function abbQueries(query: string): string[] {
  const out: string[] = [];
  const add = (words: string[]) => {
    const q = words.join(' ').trim();
    if (q && !out.includes(q)) out.push(q);
  };
  // "Title - Author" (how ABB and most sites write it).
  const dash = query.split(/\s+[-–—]\s+/);
  const author = dash.length > 1 ? keyWords(dash[dash.length - 1]) : [];
  const titlePart = dash.length > 1 ? dash.slice(0, -1).join(' ') : query;
  const key = keyWords(titlePart);
  // "Book 5 of Ajax's Ascension" / "Ajax's Ascension, Book 5": the series on its own.
  const series = titlePart.match(/\bbook\s+\d+\s+of\s+(.+)$/i)?.[1] ?? titlePart.match(/^(.+?),?\s+book\s+\d+/i)?.[1];
  add(key.slice(0, 4));
  if (author.length) add([...key.slice(0, 2), ...author.slice(0, 1)]);
  if (series) add(keyWords(series));
  // The most distinctive words on their own (longest first).
  const distinctive = [...key].sort((a, b) => b.length - a.length);
  add(distinctive.slice(0, 2));
  add(distinctive.slice(0, 1));
  if (author.length) add(author);
  return out.slice(0, 5);
}

export type AbbSearch = {
  results: AbbResult[];
  more: boolean;
  /** Next page for every question that still had full pages. */
  loadMore: () => Promise<AbbSearch>;
};

/**
 * Searches AudiobookBay the smart way: several questions (see abbQueries), two pages
 * each, merged and ranked against everything you typed.
 */
export async function searchAbbSmart(
  query: string,
  /** Called with the results so far each time an answer comes in, so the list fills as it goes. */
  onUpdate?: (s: AbbSearch) => void,
): Promise<AbbSearch> {
  const queries = abbQueries(query);
  if (!queries.length) return { results: [], more: false, loadMore: async () => searchAbbSmart(query) };
  const seen = new Map<string, AbbResult>();
  // Compare words without possessives ("ajax" = "ajax's").
  const stem = (w: string) => w.replace(/'s$/, '').replace(/'/g, '');
  const want = keyWords(query).map(stem);
  // A book number in the search ("… Monsters 10", "book 5") lifts the release with that number.
  const nums = wordsOf(query).filter((w) => /^\d+$/.test(w));
  const rank = (r: AbbResult) => {
    const have = new Set(keyWords(r.title).map(stem));
    const hit = want.length ? want.filter((w) => have.has(w)).length / want.length : 1;
    const numbered = nums.length && nums.every((n) => wordsOf(r.title).includes(n)) ? 0.1 : 0;
    return hit + numbered;
  };
  const pages = new Map(queries.map((q) => [q, 0]));
  const open = new Set(queries);
  let firstError: unknown = null;

  const snapshot = (): AbbSearch => ({
    results: [...seen.values()].sort((a, b) => b.score - a.score),
    more: open.size > 0,
    loadMore: async () => {
      await fetchRound([...open], 1);
      return finish();
    },
  });
  const finish = () => {
    if (!seen.size && firstError) throw firstError;
    return snapshot();
  };

  /** Next page of each question, at most 3 at a time; results show as each one answers. */
  async function fetchRound(qs: string[], count: number) {
    const jobs = qs.flatMap((q) => Array.from({ length: count }, (_, i) => ({ q, page: pages.get(q)! + i + 1 })));
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const { q, page } = jobs[next++];
        try {
          const r = await searchAbb(q, page);
          pages.set(q, Math.max(pages.get(q)!, page));
          if (!r.more) open.delete(q);
          for (const item of r.results) if (!seen.has(item.link)) seen.set(item.link, { ...item, score: rank(item) });
          onUpdate?.(snapshot());
        } catch (e) {
          firstError ??= e;
          open.delete(q);
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  // First page of each question (the best ones first), then a second page of the main one.
  await fetchRound(queries, 1);
  if (seen.size < 15 && open.has(queries[0])) await fetchRound([queries[0]], 1);
  // Searched a series or a title? Also ask for the author of the best matches: ABB often
  // lists a book under the author but not under every way of writing the series name.
  const best = [...seen.values()].filter((r) => r.score >= 1 && r.author);
  const counts = new Map<string, number>();
  for (const r of best) for (const a of r.author!.split(/,\s*/)) counts.set(a, (counts.get(a) ?? 0) + 1);
  const topAuthor = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
  const authorQ = topAuthor ? keyWords(topAuthor).join(' ') : '';
  if (authorQ && !pages.has(authorQ) && seen.size < 60) {
    pages.set(authorQ, 0);
    open.add(authorQ);
    await fetchRound([authorQ], 1);
  }
  return finish();
}
