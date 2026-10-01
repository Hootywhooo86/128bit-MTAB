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
import { magnetFromHash } from './torbox';

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
};

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

/** Adds a book (and marks it Want to Read on Hardcover, if connected). */
export async function addWanted(book: { title: string; author?: string; cover?: string }) {
  const id = wantedId(book.title, book.author);
  const list = await getWanted();
  if (list.some((w) => w.id === id)) return;
  await saveWanted([{ ...book, title: cleanTitle(book.title), id, addedAt: Date.now() }, ...list]);
  hardcoverWantToRead(book.title, book.author).catch(() => {});
}

export async function removeWanted(id: string) {
  await saveWanted((await getWanted()).filter((w) => w.id !== id));
}

export async function markSent(id: string, sentName: string) {
  await saveWanted(
    (await getWanted()).map((w) => (w.id === id ? { ...w, sentAt: Date.now(), sentName } : w)),
  );
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

let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, { at: number; matches: Match[] }>();
const CACHE_MS = 30 * 60_000;

/** Best matches first. Searches run one at a time so the sites aren't hammered. */
export function findMatches(book: { title: string; author?: string }, fresh = false) {
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

async function search(book: { title: string; author?: string }): Promise<Match[]> {
  const title = cleanTitle(book.title);
  const fits = (name: string, score: number) => score >= 0.75 && authorFits(name, book.author);

  const abb = searchAbb(title).then(({ results }) =>
    results
      .filter((r) => fits(r.title, r.score))
      .map<Match>((r) => ({
        name: r.title,
        where: 'AudiobookBay',
        size: r.sizeText,
        cover: r.cover,
        score: r.score,
        magnet: async () => (await resolveTorrent(r)).magnet,
      })),
  );
  const sources = getSources().then((all) =>
    Promise.all(
      all
        .filter((s) => s.enabled !== false && !isCatalog(s.config))
        .map((s) =>
          searchSource(s.config, { title, author: book.author })
            .then((rs) =>
              rs
                .filter((r) => fits(r.title, matchScore(title, r.title)))
                .map<Match>((r) => ({
                  name: r.title,
                  where: s.config.name,
                  size: r.size ? `${(r.size / 1e6).toFixed(0)} MB` : undefined,
                  seeders: r.seeders,
                  score: r.score,
                  magnet: async () => r.magnet ?? magnetFromHash(r.infoHash!, r.title),
                })),
            )
            .catch(() => [] as Match[]),
        ),
    ),
  );
  const [fromAbb, fromSources] = await Promise.all([abb.catch(() => [] as Match[]), sources]);
  return [...fromAbb, ...fromSources.flat()].sort(
    (a, b) => b.score - a.score || (b.seeders ?? 0) - (a.seeders ?? 0),
  );
}
