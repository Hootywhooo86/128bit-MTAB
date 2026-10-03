/**
 * WEBTOON (webtoons.com), read online: search, episode lists and pages. Nothing is
 * downloaded; images need webtoons.com as the Referer or their server refuses them.
 *
 * Ids: comic `wt:w:8177` (Originals) or `wt:c:1122065` (Canvas); episode `wt:w:8177:5`.
 */
import type { Comic, ComicChapter } from './comics';

const SITE = 'https://www.webtoons.com';
const MOBILE = 'https://m.webtoons.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
/** Sent with every WEBTOON image. */
export const WEBTOON_HEADERS = { Referer: `${SITE}/` };

export const isWebtoon = (id: string) => id.startsWith('wt:');
export const isWebtoonImage = (uri: string) => /^https:\/\/[a-z-]*webtoon[a-z-]*\.pstatic\.net\//.test(uri);

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&rsquo;|&lsquo;/g, '’')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

async function page(url: string) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: `${SITE}/` } });
  if (!res.ok) throw new Error(`WEBTOON answered ${res.status}`);
  return res.text();
}

function parseId(id: string) {
  const [, kind, titleNo, episode] = id.split(':');
  return { canvas: kind === 'c', titleNo, episode };
}

/** Search Originals and Canvas. Originals come first. */
export async function searchWebtoons(query: string): Promise<Comic[]> {
  const html = await page(`${SITE}/en/search?keyword=${encodeURIComponent(query)}`);
  const out: Comic[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a href="[^"]*\/list\?title_no=(\d+)"[^>]*data-webtoon-type="(\w+)"[\s\S]*?<\/a>/g)) {
    const block = m[0];
    const id = `wt:${m[2] === 'CHALLENGE' ? 'c' : 'w'}:${m[1]}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title: decode(block.match(/<strong class="title">([^<]*)/)?.[1]?.trim() ?? 'Untitled'),
      cover: block.match(/<img src="([^"]+)"/)?.[1],
      author: decode(block.match(/<div class="author">([^<]*)/)?.[1]?.trim() ?? '') || undefined,
    });
  }
  return out;
}

/** Title, cover and blurb from the series page. */
export async function getWebtoon(id: string): Promise<Comic> {
  const { canvas, titleNo } = parseId(id);
  const html = await page(
    canvas ? `${SITE}/en/canvas/x/list?title_no=${titleNo}` : `${SITE}/episodeList?titleNo=${titleNo}`,
  );
  const og = (p: string) => html.match(new RegExp(`<meta property="og:${p}" content="([^"]*)"`))?.[1];
  const author = html.match(/<meta property="com-linewebtoon:webtoon:author" content="([^"]*)"/)?.[1];
  return {
    id,
    title: decode(og('title') ?? 'WEBTOON'),
    cover: og('image')?.replace(/\?type=.*$/, '?type=q90'),
    description: og('description') ? decode(og('description')!) : undefined,
    author: author ? decode(author) : undefined,
    tags: ['WEBTOON'],
  };
}

type RawEpisode = { episodeNo: number; episodeTitle: string; exposureDateMillis?: number };

/** Every free episode, oldest first. */
export async function getWebtoonEpisodes(id: string): Promise<ComicChapter[]> {
  const { canvas, titleNo } = parseId(id);
  const res = await fetch(`${MOBILE}/api/v1/${canvas ? 'canvas' : 'webtoon'}/${titleNo}/episodes?pageSize=99999`, {
    headers: { 'User-Agent': UA, Referer: `${MOBILE}/` },
  });
  if (!res.ok) throw new Error(`WEBTOON answered ${res.status}`);
  const body = (await res.json()) as { result?: { episodeList?: RawEpisode[] } };
  return (body.result?.episodeList ?? [])
    .sort((a, b) => a.episodeNo - b.episodeNo)
    .map((e) => ({
      id: `${id}:${e.episodeNo}`,
      number: String(e.episodeNo),
      label: decode(e.episodeTitle),
      pages: 1, // known once opened
      publishedAt: e.exposureDateMillis ? new Date(e.exposureDateMillis).toISOString() : undefined,
    }));
}

/** The episode's image strips, top to bottom. */
export async function getWebtoonPages(chapterId: string): Promise<string[]> {
  const { canvas, titleNo, episode } = parseId(chapterId);
  const html = await page(
    `${SITE}/en/${canvas ? 'canvas' : 'x'}/x/x/viewer?title_no=${titleNo}&episode_no=${episode}`, // redirects to the real page
  );
  const urls = [...html.matchAll(/<img[^>]*class="_images"[^>]*data-url="([^"]+)"/g)].map((m) => decode(m[1]));
  if (!urls.length) throw new Error('This episode has no free pages (it may be Daily Pass / paid).');
  return urls;
}
