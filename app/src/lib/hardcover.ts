/**
 * Hardcover (hardcover.app) book tracking.
 *
 * Uses the personal API token from https://hardcover.app/account/api. When you
 * listen to a book, 128bit finds it on Hardcover, marks it "Currently reading",
 * keeps the listening progress up to date, and marks it "Read" at the end.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { secureGet, secureSet } from './storage';
import type { PlayableBook } from './types';

const API = 'https://api.hardcover.app/v1/graphql';
const TOKEN_KEY = '128bit.hardcover';
const MATCH_KEY = (bookKey: string) => `128bit.hardcover.match.${bookKey}`;

const STATUS = { wantToRead: 1, reading: 2, read: 3 } as const;

export type HardcoverBook = {
  id: number;
  title: string;
  author?: string;
  cover?: string;
  year?: number;
  /** Audiobook length on Hardcover, when it knows it. */
  audioSeconds?: number;
};

export const getHardcoverToken = () => secureGet(TOKEN_KEY);

/** The token page shows "Bearer eyJ…"; accept it with or without the prefix. */
export const setHardcoverToken = (token: string | null) =>
  secureSet(TOKEN_KEY, token?.trim().replace(/^bearer\s+/i, '') || null);

async function gql<T>(query: string, variables: Record<string, unknown> = {}, token?: string) {
  const t = token ?? (await getHardcoverToken());
  if (!t) throw new Error('Not connected to Hardcover');
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: `Bearer ${t}`,
      'User-Agent': '128bit',
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json().catch(() => null)) as {
    data?: T;
    errors?: { message: string }[];
    error?: string;
    error_description?: string;
  } | null;
  if (!res.ok || !body || body.errors?.length || body.error) {
    throw new Error(
      body?.errors?.[0]?.message ??
        body?.error_description ??
        body?.error ??
        `Hardcover answered ${res.status}`,
    );
  }
  return body.data as T;
}

type Me = { id: number; username: string };

/** Who the token belongs to. Also used to test a token before saving it. */
export async function hardcoverMe(token?: string): Promise<Me> {
  const data = await gql<{ me: Me[] | Me }>('query { me { id username } }', {}, token);
  const me = Array.isArray(data.me) ? data.me[0] : data.me;
  if (!me) throw new Error('Hardcover did not recognise this token');
  return me;
}

type SearchDoc = {
  id: string | number;
  title: string;
  author_names?: string[];
  image?: { url?: string };
  release_year?: number;
  audio_seconds?: number;
};

export async function searchHardcover(query: string): Promise<HardcoverBook[]> {
  const data = await gql<{ search: { results: { hits?: { document: SearchDoc }[] } } }>(
    `query Search($q: String!) {
      search(query: $q, query_type: "Book", per_page: 10, page: 1) { results }
    }`,
    { q: query },
  );
  return (data.search.results.hits ?? []).map(({ document: d }) => ({
    id: Number(d.id),
    title: d.title,
    author: d.author_names?.join(', '),
    cover: d.image?.url,
    year: d.release_year,
    audioSeconds: d.audio_seconds || undefined,
  }));
}

// --- Which Hardcover book is this? -------------------------------------------

/** `null` = the user chose "don't track"; `undefined` = not matched yet. */
export async function getMatch(bookKey: string): Promise<HardcoverBook | null | undefined> {
  const raw = await AsyncStorage.getItem(MATCH_KEY(bookKey));
  return raw === null ? undefined : (JSON.parse(raw) as HardcoverBook | null);
}

export const setMatch = (bookKey: string, match: HardcoverBook | null) =>
  AsyncStorage.setItem(MATCH_KEY(bookKey), JSON.stringify(match));

const clean = (s: string) =>
  s
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\b(unabridged|abridged|audiobook|m4b|mp3)\b/gi, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Finds (once) and remembers the Hardcover book for something you're listening to. */
async function matchFor(book: PlayableBook): Promise<HardcoverBook | null> {
  const saved = await getMatch(book.key);
  if (saved !== undefined) return saved;
  const query = [clean(book.title), book.author].filter(Boolean).join(' ');
  const [best] = await searchHardcover(query).catch(() => []);
  if (!best) return null; // try again next time
  await setMatch(book.key, best);
  return best;
}

// --- Syncing ----------------------------------------------------------------

type UserBook = {
  id: number;
  status_id: number;
  user_book_reads: { id: number; finished_at?: string | null }[];
};

async function userBook(bookId: number): Promise<UserBook | null> {
  const data = await gql<{ me: { user_books: UserBook[] }[] | { user_books: UserBook[] } }>(
    `query UB($id: Int!) {
      me {
        user_books(where: { book_id: { _eq: $id } }, limit: 1) {
          id status_id
          user_book_reads(order_by: { id: desc }, limit: 1) { id finished_at }
        }
      }
    }`,
    { id: bookId },
  );
  const me = Array.isArray(data.me) ? data.me[0] : data.me;
  return me?.user_books[0] ?? null;
}

async function ensureUserBook(bookId: number, status: number): Promise<UserBook> {
  const existing = await userBook(bookId);
  if (existing) {
    if (existing.status_id !== status) {
      await gql(
        `mutation S($id: Int!, $s: Int!) { update_user_book(id: $id, object: { status_id: $s }) { id error } }`,
        { id: existing.id, s: status },
      );
    }
    return { ...existing, status_id: status };
  }
  const data = await gql<{ insert_user_book: { id: number | null; error?: string | null } }>(
    `mutation I($id: Int!, $s: Int!) { insert_user_book(object: { book_id: $id, status_id: $s }) { id error } }`,
    { id: bookId, s: status },
  );
  if (!data.insert_user_book.id) throw new Error(data.insert_user_book.error ?? 'Could not add');
  return { id: data.insert_user_book.id, status_id: status, user_book_reads: [] };
}

const today = () => new Date().toISOString().slice(0, 10);

/** "10:17:59" → seconds. */
function parseDuration(text?: string) {
  if (!text) return 0;
  const parts = text.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

function totalSeconds(book: PlayableBook, match: HardcoverBook) {
  if (book.chapters.every((c) => c.seconds)) {
    return book.chapters.reduce((s, c) => s + c.seconds!, 0);
  }
  return match.audioSeconds || parseDuration(book.duration);
}

const lastSync = new Map<string, number>();
const SYNC_EVERY_MS = 5 * 60_000;
let lastResult: { at: number; ok: boolean; message: string } | null = null;

/** What the last sync did, for Settings. */
export const lastHardcoverSync = () => lastResult;

/**
 * Updates Hardcover with how far through `book` you are (0..1). Throttled, safe to
 * call often; does nothing when Hardcover isn't connected.
 */
export async function hardcoverProgress(book: PlayableBook, fraction: number, finished: boolean) {
  if (!finished && Date.now() - (lastSync.get(book.key) ?? 0) < SYNC_EVERY_MS) return;
  if (!(await getHardcoverToken())) return;
  lastSync.set(book.key, Date.now());
  try {
    const match = await matchFor(book);
    if (!match) return;
    const ub = await ensureUserBook(match.id, finished ? STATUS.read : STATUS.reading);
    const total = totalSeconds(book, match);
    const read: Record<string, unknown> = {};
    if (total) read.progress_seconds = Math.round(total * Math.min(1, fraction));
    if (finished) read.finished_at = today();
    const current = ub.user_book_reads[0];
    if (current && !current.finished_at) {
      await gql(
        `mutation U($id: Int!, $r: DatesReadInput!) { update_user_book_read(id: $id, object: $r) { id error } }`,
        { id: current.id, r: read },
      );
    } else {
      await gql(
        `mutation R($id: Int!, $r: DatesReadInput!) { insert_user_book_read(user_book_id: $id, user_book_read: $r) { id error } }`,
        { id: ub.id, r: { started_at: today(), ...read } },
      );
    }
    lastResult = {
      at: Date.now(),
      ok: true,
      message: `${match.title}: ${finished ? 'marked read' : `${Math.round(fraction * 100)}%`}`,
    };
  } catch (e) {
    lastResult = { at: Date.now(), ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// --- Want to Read (the Wanted list) -----------------------------------------

/** Adds a book to your Hardcover "Want to Read" (left alone if it's already on a shelf). */
export async function hardcoverWantToRead(title: string, author?: string) {
  if (!(await getHardcoverToken())) return;
  const [best] = await searchHardcover([clean(title), author].filter(Boolean).join(' '));
  if (!best) return;
  if (await userBook(best.id)) return;
  await gql(
    `mutation W($id: Int!) { insert_user_book(object: { book_id: $id, status_id: ${STATUS.wantToRead} }) { id error } }`,
    { id: best.id },
  );
}

type WantRow = {
  book: {
    id: number;
    title: string;
    image?: { url?: string } | null;
    contributions?: { author?: { name?: string } | null }[];
  };
};

/** Your Hardcover "Want to Read" books, newest first. */
export async function hardcoverWantList(): Promise<HardcoverBook[]> {
  const data = await gql<{ me: { user_books: WantRow[] }[] | { user_books: WantRow[] } }>(
    `query { me { user_books(where: { status_id: { _eq: ${STATUS.wantToRead} } }, order_by: { id: desc }, limit: 200) {
      book { id title image { url } contributions(limit: 1) { author { name } } }
    } } }`,
  );
  const me = Array.isArray(data.me) ? data.me[0] : data.me;
  return (me?.user_books ?? []).map(({ book }) => ({
    id: book.id,
    title: book.title,
    author: book.contributions?.[0]?.author?.name ?? undefined,
    cover: book.image?.url ?? undefined,
  }));
}
