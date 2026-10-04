/**
 * Weeb Central (weebcentral.com): a full manga/manhwa catalogue (Jujutsu Kaisen, Solo
 * Leveling, One Piece…), built in like a Mihon extension. Read online or download chapters.
 *
 * Ids: comic `wc:<series id>`, chapter `wc:ch:<chapter id>`.
 */
import type { Comic, ComicChapter } from './comics';

const SITE = 'https://weebcentral.com';
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';

export const isWeebCentral = (id: string) => id.startsWith('wc:');

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&rsquo;|&lsquo;/g, '’')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&hellip;/g, '…')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
const text = (html: string) => decode(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

async function page(path: string) {
  let res: Response;
  try {
    res = await fetch(`${SITE}${path}`, { headers: { 'User-Agent': UA, 'HX-Request': 'true', Referer: `${SITE}/` } });
  } catch {
    throw new Error('Couldn’t reach Weeb Central. Check the connection (or a DNS/ad blocker).');
  }
  if (!res.ok) throw new Error(`Weeb Central answered ${res.status}`);
  return res.text();
}

const cover = (id: string) => `https://temp.compsci88.com/cover/fallback/${id}.jpg`;

export type WcSort = 'Best Match' | 'Popularity' | 'Latest Updates';

/** Search (or browse by popularity / latest updates when `query` is empty). */
export async function searchWeebCentral(query: string, sort: WcSort = 'Best Match', offset = 0): Promise<Comic[]> {
  const qs = new URLSearchParams({
    text: query,
    sort,
    order: sort === 'Best Match' ? 'Ascending' : 'Descending',
    official: 'Any',
    display_mode: 'Full Display',
    limit: '24',
    offset: String(offset),
  });
  const html = await page(`/search/data?${qs}`);
  const out: Comic[] = [];
  for (const block of html.split('<article class="bg-base-300').slice(1)) {
    const id = block.match(/\/series\/([0-9A-Z]{26})\//)?.[1];
    if (!id || out.some((c) => c.id === `wc:${id}`)) continue;
    const title = block.match(/alt="([^"]+) cover"/)?.[1] ?? block.match(/truncate[^>]*>([^<]+)</)?.[1];
    const author = [...block.matchAll(/search\?author=[^"]*"[^>]*>([^<]+)</g)].map((m) => decode(m[1])).join(', ');
    out.push({
      id: `wc:${id}`,
      title: decode(title?.trim() ?? 'Untitled'),
      cover: cover(id),
      author: author || undefined,
    });
  }
  return out;
}

/** Title, cover, authors, blurb, status and tags. */
export async function getWeebCentral(id: string): Promise<Comic> {
  const sid = id.slice(3);
  const html = await page(`/series/${sid}`);
  const og = (p: string) => html.match(new RegExp(`<meta property="og:${p}" content="([^"]*)"`))?.[1];
  const field = (name: string) => {
    const i = html.indexOf(`<strong>${name}: </strong>`);
    return i < 0 ? '' : html.slice(i + name.length + 19, html.indexOf('</li>', i));
  };
  const desc = html.match(/Description<\/strong>\s*<p[^>]*>([\s\S]*?)<\/p>/)?.[1];
  const year = Number(text(field('Released')));
  return {
    id,
    title: decode((og('title') ?? 'Manga').replace(/\s*\|\s*Weeb Central$/, '')),
    cover: og('image') ?? cover(sid),
    author: [...field('Author(s)').matchAll(/>([^<]+)<\/a>/g)].map((m) => decode(m[1])).join(', ') || undefined,
    description: desc ? text(desc) : undefined,
    status: text(field('Status')).toLowerCase() || undefined,
    year: year > 1900 ? year : undefined,
    tags: [...field('Tags(s)').matchAll(/>([^<]+)<\/a>/g)].map((m) => decode(m[1])).slice(0, 8),
  };
}

/** Every chapter, oldest first. */
export async function getWeebCentralChapters(id: string): Promise<ComicChapter[]> {
  const html = await page(`/series/${id.slice(3)}/full-chapter-list`);
  const out: ComicChapter[] = [];
  for (const m of html.matchAll(/href="\/chapters\/([0-9A-Z]{26})"[\s\S]*?<\/a>/g)) {
    const block = m[0];
    const label = text(block.match(/<span class="">([\s\S]*?)<\/span>/)?.[1] ?? '') || 'Chapter';
    out.push({
      id: `wc:ch:${m[1]}`,
      number: label.match(/(\d+(?:\.\d+)?)\s*$/)?.[1],
      label,
      pages: 1, // known once opened
      publishedAt: block.match(/datetime="([^"]+)"/)?.[1],
    });
  }
  return out.reverse();
}

/** The chapter's page images, in order. */
export async function getWeebCentralPages(chapterId: string): Promise<string[]> {
  const cid = chapterId.slice(6);
  const html = await page(`/chapters/${cid}/images?is_prev=False&current_page=1&reading_style=long_strip`);
  const urls = [...html.matchAll(/<img[^>]*?\ssrc="(https:\/\/[^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !/\/static\//.test(u));
  if (!urls.length) throw new Error('No pages found for this chapter.');
  return [...new Set(urls)];
}
