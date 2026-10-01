/**
 * RSS feeds of new audiobook uploads (e.g. AudiobookBay's /rss).
 *
 * A feed lists the newest posts. When you send one to TorBox, 128bit finds the
 * torrent for it: a magnet or info hash in the feed item itself (torrent-site and
 * Torznab feeds), or otherwise on the post's web page (AudiobookBay shows the info
 * hash and trackers there), and builds the magnet from that.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '128bit.feeds';
const SEEDED_KEY = '128bit.defaultFeedsInstalled';

export const DEFAULT_FEEDS = [{ name: 'AudiobookBay', url: 'http://audiobookbay.se/rss' }];

export type Feed = { url: string; name: string; enabled?: boolean };

export type FeedItem = {
  title: string;
  /** The post's web page. */
  link?: string;
  author?: string;
  narrator?: string;
  format?: string;
  bitrate?: string;
  sharedBy?: string;
  summary?: string;
  date?: string;
  /** When the feed item already has the torrent. */
  magnet?: string;
  infoHash?: string;
  size?: number;
};

export type Torrent = {
  magnet: string;
  infoHash: string;
  size?: string;
  cover?: string;
};

// --- Saved feeds ------------------------------------------------------------

export async function getFeeds(): Promise<Feed[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]');
  } catch {
    return [];
  }
}

const saveFeeds = (feeds: Feed[]) => AsyncStorage.setItem(KEY, JSON.stringify(feeds));

/** Checks the feed works, then saves it under the feed's own title. */
export async function addFeed(input: string): Promise<Feed> {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  const { title } = await fetchFeed(url);
  const feeds = await getFeeds();
  const feed: Feed = { url, name: shortName(title, url) };
  await saveFeeds([...feeds.filter((f) => f.url !== url), feed]);
  return feed;
}

export async function removeFeed(url: string) {
  await saveFeeds((await getFeeds()).filter((f) => f.url !== url));
}

export async function setFeedEnabled(url: string, enabled: boolean) {
  await saveFeeds((await getFeeds()).map((f) => (f.url === url ? { ...f, enabled } : f)));
}

/** Adds the default feeds once; tries again next launch if offline. */
export async function installDefaultFeeds() {
  if (await AsyncStorage.getItem(SEEDED_KEY)) return;
  const feeds = await getFeeds();
  const missing = DEFAULT_FEEDS.filter((d) => !feeds.some((f) => f.url === d.url));
  await saveFeeds([...feeds, ...missing]);
  await AsyncStorage.setItem(SEEDED_KEY, '1');
}

function shortName(title: string, url: string) {
  const short = title.replace(/\s*\(.*\)\s*$/, '').trim();
  return short || url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
}

// --- Parsing ----------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(s: string) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Text of the first <tag> in `xml`, CDATA unwrapped. */
function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return undefined;
  return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
}

const stripHtml = (s: string) =>
  decodeEntities(s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+/g, ' ')
    .trim();

const HASH = /\b([0-9a-f]{40})\b/i;

/** AudiobookBay-style description: "Shared by:x … Written by A Read by B Format: M4B Bitrate: 64 Kbps …". */
function parseDescription(text: string) {
  const grab = (re: RegExp) => text.match(re)?.[1]?.trim();
  const facts = /Written by|Read by|Format:|Bitrate:/i;
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    sharedBy: grab(/Shared by:\s*(\S+)/i),
    author: grab(/Written by\s+(.+?)(?=\s+Read by|\s+Format:|\s+Bitrate:|$)/im),
    narrator: grab(/Read by\s+(.+?)(?=\s+Format:|\s+Bitrate:|$)/im),
    format: grab(/Format:\s*(\S+)/i),
    bitrate: grab(/Bitrate:\s*([\d.]+\s*\w+)/i),
    summary: lines
      .filter((l) => !/^Shared by:/i.test(l) && !facts.test(l))
      .join(' ')
      .replace(/\s*\[(\.\.\.|…)\]\s*$/, '…'),
  };
}

function parseItem(xml: string): FeedItem {
  const title = stripHtml(tag(xml, 'title') ?? 'Untitled');
  const link = tag(xml, 'link') ?? xml.match(/<link[^>]*href="([^"]+)"/i)?.[1];
  const description = stripHtml(tag(xml, 'description') ?? tag(xml, 'summary') ?? '');
  const enclosure = xml.match(/<enclosure[^>]*url="([^"]+)"/i)?.[1];
  const torznabHash = xml.match(/name="infohash"\s+value="([0-9a-f]{40})"/i)?.[1];
  const size = xml.match(/name="size"\s+value="(\d+)"/i)?.[1] ?? xml.match(/length="(\d+)"/i)?.[1];
  const magnet = [link, enclosure, tag(xml, 'guid'), xml.match(/magnet:\?[^"'<\s\]]+/)?.[0]]
    .map((v) => (v ? decodeEntities(v) : v))
    .find((v) => v?.startsWith('magnet:'));
  return {
    title,
    link: link && !link.startsWith('magnet:') ? decodeEntities(link) : undefined,
    date: tag(xml, 'pubDate'),
    magnet,
    infoHash: (torznabHash ?? magnet?.match(/btih:([0-9a-f]{40})/i)?.[1])?.toLowerCase(),
    size: size ? Number(size) : undefined,
    ...parseDescription(description),
  };
}

export async function fetchFeed(url: string): Promise<{ title: string; items: FeedItem[] }> {
  const res = await fetch(url, { headers: { Accept: 'application/rss+xml, text/xml, */*' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const xml = await res.text();
  if (!/<(rss|feed|channel)[\s>]/i.test(xml)) throw new Error("That link isn't an RSS feed");
  const channel = xml.split(/<item[\s>]|<entry[\s>]/i)[0];
  const items = [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)].map((m) => parseItem(m[0]));
  return { title: stripHtml(tag(channel, 'title') ?? ''), items };
}

// --- Finding the torrent ----------------------------------------------------

const PUBLIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://exodus.desync.com:6969/announce',
];

function buildMagnet(hash: string, name: string, trackers: string[]) {
  const tr = [...new Set([...trackers, ...PUBLIC_TRACKERS])]
    .map((t) => `&tr=${encodeURIComponent(t)}`)
    .join('');
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name)}${tr}`;
}

/** The torrent for a feed item: from the item itself, or from its web page. */
export async function resolveTorrent(item: FeedItem): Promise<Torrent> {
  if (item.magnet || item.infoHash) {
    const infoHash = item.infoHash ?? item.magnet!.match(/btih:([0-9a-z]+)/i)![1].toLowerCase();
    return { infoHash, magnet: item.magnet ?? buildMagnet(infoHash, item.title, []) };
  }
  if (!item.link) throw new Error('This post has no link to look up');
  const res = await fetch(item.link);
  if (!res.ok) throw new Error(`The post page answered ${res.status}`);
  const html = await res.text();

  const magnet = html.match(/magnet:\?xt=urn:btih:[^"'<\s]+/i)?.[0];
  const hash =
    html.match(/Info Hash:?\s*<\/t[dh]>\s*<td[^>]*>\s*([0-9a-f]{40})/i)?.[1] ??
    magnet?.match(/btih:([0-9a-f]{40})/i)?.[1] ??
    html.match(/info.?hash[^0-9a-f]{0,80}([0-9a-f]{40})/i)?.[1] ??
    html.match(HASH)?.[1];
  if (!hash) {
    throw new Error(
      /log ?in|sign ?in|captcha|cloudflare/i.test(html)
        ? 'The post page wants a login or a captcha, so the torrent couldn’t be found'
        : 'Couldn’t find the torrent on the post page',
    );
  }
  const trackers = [...html.matchAll(/Tracker:\s*<\/td>\s*<td[^>]*>\s*([^<\s]+)\s*</gi)].map(
    (m) => decodeEntities(m[1]),
  );
  const sizeCell = html.match(/Combined File Size:?\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i)?.[1];
  const size = sizeCell ? stripHtml(sizeCell).replace(/\s+/g, ' ') : undefined;
  // The post's own picture (marked itemprop="image" on AudiobookBay), not the site's icons.
  const host = item.link.split('/')[2];
  const images = [...html.matchAll(/<img[^>]+>/gi)].map((m) => m[0]);
  const srcOf = (img?: string) => img?.match(/src=["'](https?:[^"']+)["']/i)?.[1];
  const cover =
    srcOf(images.find((img) => /itemprop=["']image["']/i.test(img))) ??
    images
      .map(srcOf)
      .find((src) => src && src.split('/')[2] !== host && !/logo|icon|banner|avatar/i.test(src));
  return {
    infoHash: hash.toLowerCase(),
    magnet: magnet ? decodeEntities(magnet) : buildMagnet(hash.toLowerCase(), item.title, trackers),
    size,
    cover,
  };
}
