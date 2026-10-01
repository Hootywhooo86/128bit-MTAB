/**
 * AudiobookBay search: reads the site's own search pages (/page/N/?s=…), the way
 * audiobookbay-automated (github.com/JamesRy96/audiobookbay-automated, MIT) does.
 * The torrent for a result comes from its post page (see resolveTorrent in feeds.ts).
 */
import { decodeEntities, type FeedItem } from './feeds';
import { matchScore } from './sources';

export const ABB_HOST = 'audiobookbay.lu';

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

/** One page of results (about 9). `more` is true when there's probably another page. */
export async function searchAbb(
  query: string,
  page = 1,
): Promise<{ results: AbbResult[]; more: boolean }> {
  const q = encodeURIComponent(query.trim().toLowerCase()).replace(/%20/g, '+');
  const res = await fetch(`https://${ABB_HOST}/page/${page}/?s=${q}`);
  // Past the last page the site answers 404.
  if (res.status === 404) return { results: [], more: false };
  if (!res.ok) throw new Error(`AudiobookBay answered ${res.status}`);
  const html = await res.text();
  const posts = html.split(/<div class="post">/).slice(1);
  const results = posts.flatMap<AbbResult>((post) => {
    const a = post.match(/class="postTitle"><h2><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) return [];
    const href = a[1].startsWith('http') ? a[1] : `https://${ABB_HOST}${a[1]}`;
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
