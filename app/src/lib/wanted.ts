/**
 * Wanted: audiobooks you want but don't have yet. 128bit looks for each one on
 * AudiobookBay and your download sources, and you send a match to TorBox with one
 * tap. Synced with Hardcover's "Want to Read" when Hardcover is connected.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { searchAbb } from './abb';
import { resolveTorrent } from './feeds';
import { getHardcoverToken, hardcoverWantList, hardcoverWantToRead } from './hardcover';
import { cleanTitle, getSources, isCatalog, matchScore, searchSource } from './sources';
import { downloadBook } from './downloads';
import { bookFromTorboxItem } from './resolve';
import { addToLibrary, getTorboxKey } from './storage';
import { addMagnet, getItem, magnetFromHash, type TorboxItem } from './torbox';
import type { PlayableBook } from './types';

const KEY = '128bit.wanted';

export type WantedBook = {
  id: string;
  title: string;
  author?: string;
  cover?: string;
  addedAt: number;
  /** Set once a match has been sent to TorBox. */
  sentAt?: number;
  sentName?: string;
  hardcoverId?: number;
  narrator?: string;
  minutes?: number;
  rating?: number;
  series?: string;
  description?: string;
  /** The TorBox torrent it was sent to. */
  torbox?: { id: number; name: string };
  /** Save it to the phone as soon as TorBox has finished. */
  autoDownload?: boolean;
  downloaded?: boolean;
};

export type WantedInput = Partial<Omit<WantedBook, 'id' | 'addedAt'>> & { title: string };

/** A torrent that looks like the wanted book. */
export type Match = {
  name: string;
  where: string;
  size?: string;
  seeders?: number;
  cover?: string;
  score: number;
  /** Looks up the magnet (AudiobookBay needs a page visit for it). */
  magnet: () => Promise<string>;
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export const wantedId = (title: string, author?: string) =>
  `${norm(cleanTitle(title))}|${norm(author ?? '')}`;

export async function getWanted(): Promise<WantedBook[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]');
  } catch {
    return [];
  }
}

const saveWanted = (list: WantedBook[]) => AsyncStorage.setItem(KEY, JSON.stringify(list));

export async function isWanted(title: string, author?: string) {
  const id = wantedId(title, author);
  return (await getWanted()).some((w) => w.id === id);
}

/** Adds a book (and marks it Want to Read on Hardcover, if connected). Returns the entry. */
export async function addWanted(book: WantedInput): Promise<WantedBook> {
  const id = wantedId(book.title, book.author);
  const list = await getWanted();
  const existing = list.find((w) => w.id === id);
  if (existing) return existing;
  const entry: WantedBook = { ...book, title: cleanTitle(book.title), id, addedAt: Date.now() };
  await saveWanted([entry, ...list]);
  hardcoverWantToRead(book.title, book.author).catch(() => {});
  return entry;
}

export async function getWantedById(id: string) {
  return (await getWanted()).find((w) => w.id === id);
}

export async function updateWanted(id: string, patch: Partial<WantedBook>) {
  await saveWanted((await getWanted()).map((w) => (w.id === id ? { ...w, ...patch } : w)));
}

export async function removeWanted(id: string) {
  await saveWanted((await getWanted()).filter((w) => w.id !== id));
}

export async function markSent(id: string, sentName: string, torboxId?: number) {
  await updateWanted(id, {
    sentAt: Date.now(),
    sentName,
    ...(torboxId ? { torbox: { id: torboxId, name: sentName } } : {}),
  });
}

// --- Getting it: TorBox, then the phone ----------------------------------------

/**
 * One tap: adds the book to Wanted (and Hardcover Want to Read), finds the best
 * release on AudiobookBay / your download sources, and sends it to TorBox.
 */
export async function grabBook(book: WantedInput): Promise<WantedBook> {
  const entry = await addWanted(book);
  if (!(await getTorboxKey())) {
    throw new Error('Add your TorBox API key in Settings → Integrations first. The book is on your Wanted list.');
  }
  const [best] = await findMatches(entry, true);
  if (!best) {
    throw new Error(
      'No matching release found yet. It stays on your Wanted list; try “Choose a release myself”.',
    );
  }
  const { id } = await addMagnet(await best.magnet(), best.name);
  await markSent(entry.id, best.name, id);
  return (await getWantedById(entry.id))!;
}

export type TorboxState =
  | { state: 'none' }
  | { state: 'downloading'; progress: number; name: string }
  | { state: 'ready'; item: TorboxItem }
  | { state: 'gone' };

export async function torboxState(w: WantedBook): Promise<TorboxState> {
  if (!w.torbox) return { state: 'none' };
  try {
    const item = await getItem('torrent', w.torbox.id);
    if (item.download_finished) return { state: 'ready', item };
    return { state: 'downloading', progress: item.progress ?? 0, name: item.name };
  } catch {
    return { state: 'gone' };
  }
}

/** The wanted book as something the player can play, from its finished TorBox item. */
export function playable(w: WantedBook, item: TorboxItem): PlayableBook {
  return bookFromTorboxItem(item, {
    title: w.title,
    author: w.author,
    narrator: w.narrator,
    cover: w.cover,
  });
}

/** Saves the finished book to the phone and puts it in your Library. */
export async function downloadWanted(
  w: WantedBook,
  item: TorboxItem,
  onProgress?: (done: number, total: number) => void,
) {
  const book = playable(w, item);
  await addToLibrary(book);
  await downloadBook(book, onProgress);
  await updateWanted(w.id, { downloaded: true, autoDownload: false });
  return book;
}

let autoRunning = false;

/** Downloads every wanted book that's marked "download when ready" and is now ready. */
export async function runAutoDownloads() {
  if (autoRunning) return;
  autoRunning = true;
  try {
    for (const w of await getWanted()) {
      if (!w.torbox || !w.autoDownload || w.downloaded) continue;
      const s = await torboxState(w);
      if (s.state === 'ready') await downloadWanted(w, s.item).catch(() => {});
    }
  } finally {
    autoRunning = false;
  }
}

/** Pulls in your Hardcover Want to Read books. Returns how many were new. */
export async function importHardcoverWanted(): Promise<number> {
  if (!(await getHardcoverToken())) return 0;
  const remote = await hardcoverWantList();
  const list = await getWanted();
  const fresh = remote
    .filter((b) => !list.some((w) => w.hardcoverId === b.id || w.id === wantedId(b.title, b.author)))
    .map<WantedBook>((b) => ({
      id: wantedId(b.title, b.author),
      title: b.title,
      author: b.author,
      cover: b.cover,
      hardcoverId: b.id,
      addedAt: Date.now(),
    }));
  if (fresh.length) await saveWanted([...fresh, ...list]);
  return fresh.length;
}

// --- Looking for matches ------------------------------------------------------

/** Author check: any of the author's name words in the torrent name. */
function authorFits(name: string, author?: string) {
  if (!author) return true;
  const words = norm(author).split(' ').filter((w) => w.length > 2);
  const have = norm(name);
  return !words.length || words.some((w) => have.includes(w));
}

/** A slow or dead source shouldn't hold up the rest. */
const SOURCE_TIMEOUT_MS = 12_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timed out')), ms)),
  ]);
}

let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, { at: number; matches: Match[] }>();
const CACHE_MS = 30 * 60_000;

/** Best matches first. Searches run one at a time so the sites aren't hammered. */
export function findMatches(book: Wanted, fresh = false) {
  const key = wantedId(book.title, book.author);
  const hit = cache.get(key);
  if (hit && !fresh && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.matches);
  const run = queue.then(() => search(book));
  queue = run.catch(() => {});
  return run.then((matches) => {
    cache.set(key, { at: Date.now(), matches });
    return matches;
  });
}

type Wanted = { title: string; author?: string; series?: string };

const FILLER = new Set(
  'the a an and of book books vol volume audiobook audio unabridged abridged m4b mp3 aac flac kbps chapterized chapterised retail complete series edition narrated read by'.split(' '),
);
const numberWords: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
};

/**
 * How well a release name fits the wanted book. The title match counts most;
 * extra title words (another book's subtitle) and the wrong series number count
 * against it, so "Ajax's Ascension" picks Book 1, not Book 7.
 */
export function rankRelease(book: Wanted, name: string) {
  const title = cleanTitle(book.title);
  let score = matchScore(title, name);
  const words = (x: string) =>
    norm(x)
      .split(' ')
      .map((w) => numberWords[w] ?? w)
      .filter((w) => w && !FILLER.has(w) && !/^\d+k$/.test(w));
  const allowed = new Set([...words(title), ...words(book.author ?? ''), ...words(book.series ?? '')]);
  const extra = words(name).filter((w) => !allowed.has(w) && !/^\d+$/.test(w) && !/^(19|20)\d\d$/.test(w));
  score -= Math.min(0.4, extra.length * 0.08);

  const want = book.series?.match(/book\s*(\d+(?:\.\d+)?)/i)?.[1];
  if (want) {
    const n = norm(name);
    const numbers = [...n.matchAll(/(?:book|vol|volume|#|part)\s*(\d+(?:\.\d+)?)/g)].map((m) => m[1]);
    if (numbers.includes(want)) score += 0.3;
    else if (numbers.length) score -= 0.6;
  }
  return score;
}

async function search(book: Wanted): Promise<Match[]> {
  const title = cleanTitle(book.title);
  const fits = (name: string, score: number) => score >= 0.75 && authorFits(name, book.author);

  const abb = withTimeout(searchAbb(title), SOURCE_TIMEOUT_MS).then(({ results }) =>
    results
      .filter((r) => fits(r.title, r.score))
      .map<Match>((r) => ({
        name: r.title,
        where: 'AudiobookBay',
        size: r.sizeText,
        cover: r.cover,
        score: rankRelease(book, r.title),
        magnet: async () => (await resolveTorrent(r)).magnet,
      })),
  );
  const sources = getSources().then((all) =>
    Promise.all(
      all
        .filter((s) => s.enabled !== false && !isCatalog(s.config))
        .map((s) =>
          withTimeout(searchSource(s.config, { title, author: book.author }), SOURCE_TIMEOUT_MS)
            .then((rs) =>
              rs
                .filter((r) => fits(r.title, matchScore(title, r.title)))
                .map<Match>((r) => ({
                  name: r.title,
                  where: s.config.name,
                  size: r.size ? `${(r.size / 1e6).toFixed(0)} MB` : undefined,
                  seeders: r.seeders,
                  score: rankRelease(book, r.title),
                  magnet: async () => r.magnet ?? magnetFromHash(r.infoHash!, r.title),
                })),
            )
            .catch(() => [] as Match[]),
        ),
    ),
  );
  const [fromAbb, fromSources] = await Promise.all([abb.catch(() => [] as Match[]), sources]);
  // Weak matches (usually another book in the series) never get picked automatically.
  return [...fromAbb, ...fromSources.flat()].filter((m) => m.score >= 0.6).sort(
    (a, b) => b.score - a.score || (b.seeders ?? 0) - (a.seeders ?? 0),
  );
}
