/**
 * Audiobookshelf (https://www.audiobookshelf.org): your own self-hosted audiobook server.
 *
 * Sign in with username + password (access tokens last an hour and are refreshed
 * automatically) or paste an API key from ABS → Settings → API Keys.
 * Listening progress is synced back, so ABS's web player and other apps stay in step.
 */
import { secureGet, secureSet } from './storage';
import type { Chapter, PlayableBook } from './types';

const KEY = '128bit.abs';

type Session = {
  server: string;
  username?: string;
  accessToken: string;
  /** Missing when signed in with an API key (those don't expire). */
  refreshToken?: string;
};

export type AbsLibrary = { id: string; name: string; mediaType: string };

export type AbsItem = {
  id: string;
  title: string;
  author?: string;
  narrator?: string;
  duration?: number;
  cover: string;
};

let cached: Session | null | undefined;

async function getSession(): Promise<Session | null> {
  if (cached !== undefined) return cached;
  const raw = await secureGet(KEY);
  cached = raw ? JSON.parse(raw) : null;
  return cached ?? null;
}

async function setSession(s: Session | null) {
  cached = s;
  await secureSet(KEY, s ? JSON.stringify(s) : null);
}

const normalizeServer = (url: string) => {
  let s = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  return s;
};

export async function absConnected() {
  return !!(await getSession());
}

export async function absAccount() {
  const s = await getSession();
  return s ? { server: s.server, username: s.username } : null;
}

export async function absLogin(server: string, username: string, password: string) {
  const base = normalizeServer(server);
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-return-tokens': 'true' },
    body: JSON.stringify({ username, password }),
  });
  if (res.status === 401) throw new Error('Wrong username or password');
  if (!res.ok) throw new Error(`Audiobookshelf said ${res.status}`);
  const data = await res.json();
  const accessToken = data.user?.accessToken ?? data.user?.token;
  if (!accessToken) throw new Error('This server didn’t return a token');
  await setSession({
    server: base,
    username: data.user.username,
    accessToken,
    refreshToken: data.user.refreshToken ?? undefined,
  });
}

export async function absLoginWithApiKey(server: string, apiKey: string) {
  const base = normalizeServer(server);
  const res = await fetch(`${base}/api/me`, {
    headers: { Authorization: `Bearer ${apiKey.trim()}` },
  });
  if (!res.ok)
    throw new Error(
      res.status === 401 ? 'That API key was rejected' : `Audiobookshelf said ${res.status}`,
    );
  const me = await res.json();
  await setSession({ server: base, username: me.username, accessToken: apiKey.trim() });
}

export async function absLogout() {
  await setSession(null);
}

async function refresh(s: Session): Promise<Session | null> {
  if (!s.refreshToken) return null;
  const res = await fetch(`${s.server}/auth/refresh`, {
    method: 'POST',
    headers: { 'x-refresh-token': s.refreshToken },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const next = {
    ...s,
    accessToken: data.user.accessToken,
    refreshToken: data.user.refreshToken ?? s.refreshToken,
  };
  await setSession(next);
  return next;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let s = await getSession();
  if (!s) throw new Error('Connect Audiobookshelf in Settings → Integrations');
  const go = (session: Session) =>
    fetch(`${session.server}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${session.accessToken}` },
    });
  let res = await go(s);
  if (res.status === 401) {
    s = await refresh(s);
    if (!s) throw new Error('Your Audiobookshelf sign-in expired. Sign in again in Settings.');
    res = await go(s);
  }
  if (!res.ok) throw new Error(`Audiobookshelf said ${res.status}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** A short-lived token that's valid right now (refreshing first if needed), for file URLs. */
async function freshToken(): Promise<{ server: string; token: string }> {
  // A cheap authenticated call refreshes an expired access token as a side effect.
  await api('/api/me');
  const s = (await getSession())!;
  return { server: s.server, token: s.accessToken };
}

// --- Browsing ---------------------------------------------------------------

export async function absLibraries(): Promise<AbsLibrary[]> {
  const data = await api<{ libraries: AbsLibrary[] }>('/api/libraries');
  return data.libraries.filter((l) => l.mediaType === 'book');
}

function toItem(raw: any, server: string, token: string): AbsItem {
  const m = raw.media?.metadata ?? {};
  return {
    id: raw.id,
    title: m.title ?? 'Untitled',
    author: m.authorName ?? m.authors?.map((a: { name: string }) => a.name).join(', '),
    narrator: m.narratorName ?? m.narrators?.join(', '),
    duration: raw.media?.duration,
    cover: `${server}/api/items/${raw.id}/cover?token=${encodeURIComponent(token)}`,
  };
}

export async function absItems(libraryId: string, page = 0, limit = 50): Promise<AbsItem[]> {
  const data = await api<{ results: any[] }>(
    `/api/libraries/${libraryId}/items?limit=${limit}&page=${page}&sort=addedAt&desc=1&minified=1`,
  );
  const { server, token } = await freshToken();
  return data.results.map((r) => toItem(r, server, token));
}

export async function absSearch(libraryId: string, query: string): Promise<AbsItem[]> {
  const data = await api<{ book?: { libraryItem: any }[] }>(
    `/api/libraries/${libraryId}/search?q=${encodeURIComponent(query)}&limit=25`,
  );
  const { server, token } = await freshToken();
  return (data.book ?? []).map((b) => toItem(b.libraryItem, server, token));
}

// --- Playing ----------------------------------------------------------------

export const isAbsBook = (book: PlayableBook) => book.key.startsWith('abs:');
const itemId = (book: PlayableBook) => book.key.slice(4);

const hms = (seconds?: number) => {
  if (!seconds) return undefined;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/** Turns an ABS item into a playable book: one entry per audio file, with the book's chapters as markers. */
export async function absBook(id: string): Promise<PlayableBook> {
  const raw = await api<any>(`/api/items/${id}?expanded=1`);
  const { server, token } = await freshToken();
  const item = toItem(raw, server, token);
  const tracks: any[] = raw.media?.tracks ?? [];
  const bookChapters: { start: number; end: number; title: string }[] = raw.media?.chapters ?? [];

  const chapters: Chapter[] = tracks.map((t, i) => {
    const start = t.startOffset ?? 0;
    const end = start + (t.duration ?? 0);
    // Book chapters that begin inside this file, relative to the file's start.
    const marks = bookChapters
      .filter((c) => c.start >= start - 0.5 && c.start < end - 0.5)
      .map((c) => ({ title: c.title, start: Math.max(0, c.start - start) }));
    return {
      id: String(t.ino ?? i),
      title: t.metadata?.filename?.replace(/\.[^.]+$/, '') ?? t.title ?? `Part ${i + 1}`,
      size: t.metadata?.size,
      ext: t.metadata?.ext?.replace('.', ''),
      seconds: t.duration,
      ref: { type: 'abs', path: t.contentUrl },
      marks: marks.length > 1 ? marks : undefined,
      marksChecked: true,
    };
  });

  return {
    key: `abs:${id}`,
    title: item.title,
    author: item.author,
    narrator: item.narrator,
    duration: hms(item.duration),
    cover: item.cover,
    chapters,
  };
}

export async function absFileUrl(path: string) {
  const { server, token } = await freshToken();
  return `${server}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

/** Book time (seconds) → which file and where in it. */
function locate(book: PlayableBook, bookTime: number) {
  let offset = 0;
  for (let i = 0; i < book.chapters.length; i++) {
    const len = book.chapters[i].seconds ?? 0;
    if (bookTime < offset + len || i === book.chapters.length - 1) {
      return { chapter: i, position: Math.max(0, bookTime - offset) };
    }
    offset += len;
  }
  return { chapter: 0, position: 0 };
}

export async function absResumePoint(book: PlayableBook) {
  const p = await api<{ currentTime: number; lastUpdate: number; isFinished: boolean } | null>(
    `/api/me/progress/${itemId(book)}`,
  ).catch(() => null);
  if (!p || p.isFinished) return null;
  return { ...locate(book, p.currentTime), updatedAt: p.lastUpdate };
}

const lastReport = new Map<string, number>();

/** Sends listening progress to ABS (at most every 15 s unless the book just finished). */
export async function absReportProgress(
  book: PlayableBook,
  chapter: number,
  position: number,
  finishedBook: boolean,
) {
  if (!finishedBook && Date.now() - (lastReport.get(book.key) ?? 0) < 15_000) return;
  lastReport.set(book.key, Date.now());
  const total = book.chapters.reduce((s, c) => s + (c.seconds ?? 0), 0);
  const before = book.chapters.slice(0, chapter).reduce((s, c) => s + (c.seconds ?? 0), 0);
  const currentTime = finishedBook ? total : before + position;
  await api(`/api/me/progress/${itemId(book)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentTime,
      duration: total,
      progress: total ? currentTime / total : 0,
      isFinished: finishedBook,
    }),
  }).catch(() => {});
}
