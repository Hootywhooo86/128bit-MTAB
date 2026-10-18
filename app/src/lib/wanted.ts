/**
 * Wanted: audiobooks you want but don't have yet. 128bit looks for each one on
 * AudiobookBay and your download sources, and you send a match to TorBox with one
 * tap. Wanted is your 128bit Tracker **Audiobooks** list (starter_lists().audiobooks):
 * adding or removing here does the same there, and books added in Tracker show up
 * here. It works offline too (kept on the phone, sent when you're signed in).
 *
 * Once a book is sent to TorBox (or downloaded) it leaves Wanted for the Library
 * (Audiobooks tab) and is "listening" in Tracker; it stays on the Audiobooks list.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { searchAbbSmart } from './abb';
import { autoPickable, rankRelease, seriesName, stripFiller, titleScore } from './book-match';
import { getSession, isSignedIn, rpc } from './account';
import { resolveTorrent } from './feeds';
import { addToTrackerList, getStarterLists, invalidateTracker, removeFromTrackerList, type TrackerItem, type TrackerRef } from './tracker';
import { cleanTitle, getSources, isCatalog, searchSourceSmart } from './sources';
import { downloadBook } from './downloads';
import { bookFromTorboxItem } from './resolve';
import { addToLibrary, getLibrary, getProgressMany } from './storage';
import { addMagnet, getItem, magnetFromHash, type TorboxItem } from './torbox';
import { canGetTorrents } from './torrent-device';
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
  /** Old builds put ready books straight in the Library; kept so they can be found there. */
  inLibrary?: boolean;
  /** The Library book it plays as (TorBox / phone), once it's been played or downloaded. */
  libraryKey?: string;
  /** You've started listening: from here on it's a Library book, not a Wanted one. */
  started?: boolean;
  /** Its item on the Tracker Audiobooks list (unset: not sent there yet). */
  trackerItemId?: string;
};

/**
 * Still wanted: you haven't started it (sent to TorBox and ready still counts as wanted;
 * it moves to the Library once you start listening, or when it's downloaded to the phone).
 */
export const stillWanted = (w: WantedBook) => !w.started && !w.downloaded;

const norm2 = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Marks Wanted books you've started listening to (their Library book has progress). */
export async function markStarted() {
  const wanted = await getWanted();
  const open = wanted.filter((w) => !w.started && (w.libraryKey || w.inLibrary || w.torbox || w.downloaded));
  if (!open.length) return;
  const library = await getLibrary();
  const keyOf = (w: WantedBook) => w.libraryKey ?? library.find((b) => norm2(b.title) === norm2(w.title))?.key;
  const keys = open.map(keyOf).filter((k): k is string => !!k);
  const progress = await getProgressMany(keys);
  for (const w of open) {
    const k = keyOf(w);
    const p = k ? progress[k] : undefined;
    if (p && (p.finished || p.fraction > 0)) await updateWanted(w.id, { started: true, libraryKey: k });
  }
}

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

/** Adds a book (and puts it on your Tracker Audiobooks list). Returns the entry. */
export async function addWanted(book: WantedInput): Promise<WantedBook> {
  const id = wantedId(book.title, book.author);
  const list = await getWanted();
  const existing = list.find((w) => w.id === id);
  if (existing) return existing;
  const entry: WantedBook = { ...book, title: cleanTitle(book.title), id, addedAt: Date.now() };
  await saveWanted([entry, ...list]);
  await forgetRemoved(id);
  pushToTracker(entry).catch(() => {});
  return entry;
}

export async function getWantedById(id: string) {
  return (await getWanted()).find((w) => w.id === id);
}

export async function updateWanted(id: string, patch: Partial<WantedBook>) {
  await saveWanted((await getWanted()).map((w) => (w.id === id ? { ...w, ...patch } : w)));
}

/** Takes it off Wanted (and off the Tracker Audiobooks list; later if offline). */
export async function removeWanted(id: string) {
  const list = await getWanted();
  const gone = list.find((w) => w.id === id);
  await saveWanted(list.filter((w) => w.id !== id));
  if (!gone) return;
  const removed = await getRemoved();
  removed[id] = gone.trackerItemId ?? '';
  await AsyncStorage.setItem(REMOVED_KEY, JSON.stringify(removed));
  syncWantedWithTracker().catch(() => {});
}

/** Sent to TorBox: out of Wanted, into the Library, and "listening" in Tracker. */
export async function markSent(id: string, sentName: string, torboxId?: number) {
  await updateWanted(id, {
    sentAt: Date.now(),
    sentName,
    ...(torboxId ? { torbox: { id: torboxId, name: sentName } } : {}),
  });
  const w = await getWantedById(id);
  if (w) trackGrabbed(w).catch(() => {});
}

// --- Tracker: Wanted is the Audiobooks list ---------------------------------------

const REMOVED_KEY = '128bit.wanted.trackerRemoved';
const MIGRATED_KEY = '128bit.wanted.trackerMigrated';

const bookRef = (w: { title: string; author?: string; cover?: string }, playKey?: string): TrackerRef => ({
  type: 'book',
  title: w.title,
  creator: w.author,
  poster: w.cover,
  ids: playKey ? { play: playKey } : {},
});

/** Wanted ids taken off here while the Tracker side couldn't be told yet → their item ids. */
async function getRemoved(): Promise<Record<string, string>> {
  try {
    return JSON.parse((await AsyncStorage.getItem(REMOVED_KEY)) ?? '{}');
  } catch {
    return {};
  }
}

async function forgetRemoved(id: string) {
  const removed = await getRemoved();
  if (!(id in removed)) return;
  delete removed[id];
  await AsyncStorage.setItem(REMOVED_KEY, JSON.stringify(removed));
}

async function audiobooksList() {
  if (!isSignedIn(await getSession())) return null;
  return (await getStarterLists())?.audiobooks ?? null;
}

/** Puts one Wanted book on the Audiobooks list and remembers its Tracker item. */
async function pushToTracker(w: WantedBook) {
  const listId = await audiobooksList();
  if (!listId) return;
  const r = await addToTrackerList(listId, bookRef(w));
  if (r?.item_id) await updateWanted(w.id, { trackerItemId: r.item_id });
}

/** Got it (TorBox / phone): "listening" in Tracker, and on the Audiobooks list. */
async function trackGrabbed(w: WantedBook, playKey?: string) {
  if (!isSignedIn(await getSession())) return;
  // Still planned in Tracker: it only becomes "listening" once you start it (the player does that).
  if (!w.trackerItemId) await pushToTracker(w).catch(() => {});
  if (playKey) await rpc('track_items', { items: [{ ...bookRef(w, playKey), status: 'planned', meta: { format: 'audiobook' } }] });
  invalidateTracker();
}

let syncing: Promise<void> | null = null;

/**
 * Two-way: books added in Tracker's Audiobooks list (still planned) join Wanted; Wanted
 * books not there yet go up (all of them once, the first time); ones removed here come
 * off the list. Quietly does nothing when signed out or offline.
 */
export function syncWantedWithTracker(): Promise<void> {
  syncing ??= (async () => {
    const listId = await audiobooksList();
    if (!listId) return;
    const s = await getSession();
    const user = isSignedIn(s) ? s.user.id : '';
    // Taken off here: off the list too.
    const removed = await getRemoved();
    const remote: TrackerItem[] = [];
    for (let page = 1; page <= 10; page++) {
      const items = (await rpc<TrackerItem[]>('get_list_items', { list_id: listId, page, per_page: 200 })) ?? [];
      remote.push(...items);
      if (items.length < 200) break;
    }
    const remoteById = new Map(remote.filter((i) => i.type === 'book').map((i) => [wantedId(i.title, creatorOf(i)), i]));
    for (const [id, itemId] of Object.entries(removed)) {
      const target = itemId || remoteById.get(id)?.id;
      if (target) await removeFromTrackerList(listId, target).catch(() => {});
      remoteById.delete(id);
    }
    await AsyncStorage.removeItem(REMOVED_KEY);

    const before = await getWanted();
    let list = before;
    const migrated = (await AsyncStorage.getItem(MIGRATED_KEY)) === user;
    // Up: Wanted books the list doesn't have (every one, the first time on this account).
    for (const w of list) {
      if (!stillWanted(w)) continue;
      const there = remoteById.get(w.id);
      if (there) {
        if (w.trackerItemId !== there.id) await updateWanted(w.id, { trackerItemId: there.id });
        continue;
      }
      if (!w.trackerItemId || !migrated) await pushToTracker(w).catch(() => {});
    }
    if (!migrated) await AsyncStorage.setItem(MIGRATED_KEY, user);

    // Down: planned books on the list that aren't here yet.
    list = await getWanted();
    const have = new Set(list.map((w) => w.id));
    const fresh: WantedBook[] = [];
    for (const [id, i] of remoteById) {
      if (have.has(id) || (i.status && i.status !== 'planned')) continue;
      fresh.push({
        id,
        title: i.title,
        author: creatorOf(i),
        cover: i.poster ?? undefined,
        addedAt: Date.now(),
        trackerItemId: i.id,
      });
    }
    if (fresh.length) await saveWanted([...fresh, ...list]);
    // A Wanted book removed in Tracker (it was there before, now isn't): off Wanted too.
    // (Only ones linked before this run: the ones just sent up aren't in `remote` yet.)
    const gone = before.filter((w) => stillWanted(w) && w.trackerItemId && migrated && !remoteById.has(w.id));
    if (gone.length) {
      const ids = new Set(gone.map((w) => w.id));
      await saveWanted((await getWanted()).filter((w) => !ids.has(w.id)));
    }
  })()
    .catch(() => {})
    .finally(() => {
      syncing = null;
    });
  return syncing;
}

const creatorOf = (i: TrackerItem) => (i as TrackerItem & { creator?: string | null }).creator ?? undefined;

// --- Getting it: TorBox, then the phone ----------------------------------------

/**
 * One tap: adds the book to Wanted (and your Tracker Audiobooks list), finds the best
 * release on AudiobookBay / your download sources, and sends it to TorBox.
 */
export async function grabBook(book: WantedInput): Promise<WantedBook> {
  const entry = await addWanted(book);
  if (!(await canGetTorrents())) {
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

/**
 * "⬇ Download" on a release: sends it to TorBox like the TorBox button, and marks the book
 * (added to Wanted if it isn't there) to save to the phone as soon as TorBox has it. When
 * TorBox already has it (cached: ready at once), `item` is set so the download can start
 * now; otherwise runAutoDownloads picks it up when it's ready.
 */
export async function sendToPhone(
  book: WantedInput,
  magnet: string,
  name: string,
  /** TorBox says it has this one cached: wait a few seconds for it to be ready. */
  cached = false,
): Promise<{ wanted: WantedBook; torboxId: number; item?: TorboxItem }> {
  const entry = await addWanted(book);
  const { id } = await addMagnet(magnet, name);
  await markSent(entry.id, name, id);
  await updateWanted(entry.id, { autoDownload: true });
  const wanted = (await getWantedById(entry.id))!;
  for (let i = 0; i < (cached ? 5 : 1); i++) {
    if (i) await new Promise((r) => setTimeout(r, 2000));
    const s = await torboxState(wanted);
    if (s.state === 'ready') {
      // Known now, so the Wanted row can follow the download to the phone.
      await updateWanted(entry.id, { libraryKey: playable(wanted, s.item).key });
      return { wanted, torboxId: id, item: s.item };
    }
    if (s.state === 'gone') break;
  }
  return { wanted, torboxId: id };
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
  await updateWanted(w.id, { libraryKey: book.key });
  trackGrabbed(w, book.key).catch(() => {});
  await downloadBook(book, onProgress);
  await updateWanted(w.id, { downloaded: true, autoDownload: false });
  return book;
}

let autoRunning = false;

/**
 * Every minute: books sent to TorBox that are ready go to the phone when you asked for
 * "download when ready" (otherwise they wait in Wanted as "Ready in TorBox"); ones TorBox
 * lost go back to looking.
 */
export async function runAutoDownloads() {
  if (autoRunning) return;
  autoRunning = true;
  try {
    for (const w of await getWanted()) {
      if (!w.torbox || w.downloaded) continue;
      if (!w.autoDownload) continue;
      const s = await torboxState(w);
      if (s.state === 'ready') {
        await downloadWanted(w, s.item).catch(() => {});
      } else if (s.state === 'gone' && !w.started) {
        await updateWanted(w.id, { torbox: undefined, sentAt: undefined, sentName: undefined });
      }
    }
  } finally {
    autoRunning = false;
  }
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
const SOURCE_TIMEOUT_MS = 20_000;

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

async function search(book: Wanted): Promise<Match[]> {
  const title = cleanTitle(book.title);
  // The title's words (numbers aside: rankRelease weighs the book number), else the series'.
  const series = seriesName(stripFiller(title));
  const fits = (name: string) =>
    Math.max(titleScore(title, name), series ? titleScore(series, name) : 0) >= 0.75 && authorFits(name, book.author);

  const abb = withTimeout(searchAbbSmart(book.author ? `${title} - ${book.author}` : title), SOURCE_TIMEOUT_MS).then(({ results }) =>
    results
      .filter((r) => fits(r.title))
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
          withTimeout(searchSourceSmart(s.config, { title, author: book.author }), SOURCE_TIMEOUT_MS)
            .then((rs) =>
              rs
                .filter((r) => fits(r.title))
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
  // Weak matches (usually another book in the series) never get picked automatically, and
  // a numbered book ("Book Seven") only takes a release with that number.
  return [...fromAbb, ...fromSources.flat()].filter((m) => m.score >= 0.6 && autoPickable(book, m.name)).sort(
    (a, b) => b.score - a.score || (b.seeders ?? 0) - (a.seeders ?? 0),
  );
}
