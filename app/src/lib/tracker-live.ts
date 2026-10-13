/**
 * Live progress to 128bit Tracker: where you are in a movie, episode, audiobook or
 * comic, sent with set_progress (128bittracker/supabase/tracker.sql) every few
 * minutes while you play, and straight away when you pause, leave or finish.
 * The 30-minute history sync (tracker-sync.ts) catches anything missed.
 * Fire-and-forget: never throws, does nothing when signed out.
 */
import { getSession, isSignedIn, rpc } from './account';
import { invalidateTracker } from './tracker';

const EVERY_MS = 3 * 60_000;
const SOON_MS = 15_000;
const last = new Map<string, number>();

export const pctOf = (part: number, whole: number) =>
  whole > 0 ? Math.max(0, Math.min(100, Math.round((part / whole) * 100))) : 0;

/** "tt0078748" / "tt11280740:1:3" / "kitsu:46474:5" → ids, season, episode. */
export function parseKey(key: string) {
  const imdb = key.match(/^(tt\d+)(?::(\d+):(\d+))?$/);
  if (imdb) return { ids: { imdb: imdb[1] } as Record<string, string | number>, season: imdb[2] ? Number(imdb[2]) : undefined, episode: imdb[3] ? Number(imdb[3]) : undefined, anime: false };
  const kitsu = key.match(/^kitsu:(\d+)(?::(\d+))?$/);
  if (kitsu) return { ids: { kitsu: Number(kitsu[1]) } as Record<string, string | number>, season: kitsu[2] ? 1 : undefined, episode: kitsu[2] ? Number(kitsu[2]) : undefined, anime: true };
  return null;
}

function send(key: string, item: Record<string, unknown>, urgent: boolean) {
  const since = Date.now() - (last.get(key) ?? 0);
  if (since < (urgent ? SOON_MS : EVERY_MS)) return;
  last.set(key, Date.now());
  (async () => {
    if (!isSignedIn(await getSession())) return;
    await rpc('set_progress', { item });
    invalidateTracker();
  })().catch(() => {});
}

/** A movie or episode in the player. */
export function reportWatchProgress(
  w: { key: string; title: string; poster?: string; link?: { type: string; id: string } },
  position: number,
  duration: number,
  urgent = false,
) {
  if (!(duration > 0) || position < 30) return;
  const k = parseKey(w.key);
  const pct = pctOf(position, duration);
  const done = pct >= 95;
  const now = { pct, position_s: Math.round(position), duration_s: Math.round(duration), at: new Date().toISOString() };
  if (w.link?.type === 'movie') {
    send(w.key, {
      type: 'movie', title: w.title, poster: w.poster, ids: k?.ids ?? {},
      status: done ? 'done' : 'active', meta: done ? { pct: 100, now: null } : { pct, now },
    }, urgent || done);
    return;
  }
  if (!k?.season || !k.episode) return;
  send(w.key, {
    type: k.anime || w.link?.type === 'anime' ? 'anime' : 'show', title: w.title, poster: w.poster, ids: k.ids,
    season: k.season, status: 'active', progress: done ? k.episode : k.episode - 1,
    ...(done ? {} : { meta: { now: { ...now, episode: k.episode } } }),
  }, urgent || done);
}

/** An audiobook in the player. */
export function reportBookProgress(
  book: { key: string; title: string; author?: string; cover?: string },
  fraction: number,
  finished: boolean,
  urgent = false,
) {
  const pct = finished ? 100 : Math.round(fraction * 100);
  if (!finished && pct < 1) return;
  send(book.key, {
    type: 'book', title: book.title, creator: book.author, poster: book.cover,
    status: finished ? 'done' : 'active',
    meta: { format: 'audiobook', listened_pct: pct, pct },
  }, urgent || finished);
}

/** A comic in the reader: chapters read, and the chapter and page you're on. */
export function reportComicProgress(
  comic: { id: string; title: string; author?: string; cover?: string; lastChapter?: string },
  chapter: string,
  page: number,
  pages: number,
  read: number,
  finishedChapter: boolean,
) {
  const total = Number(comic.lastChapter);
  const meta: Record<string, unknown> = {
    now: { chapter: chapter.replace(/^(ch(apter)?\.?\s*)/i, '').slice(0, 40), page: page + 1, pages: pages || undefined, pct: pctOf(page + 1, pages), at: new Date().toISOString() },
  };
  if (total > 0) meta.pct = pctOf(read, total);
  send(`comic:${comic.id}`, {
    type: 'comic', title: comic.title, creator: comic.author, poster: comic.cover,
    status: 'active', progress: read || undefined,
    progress_total: total > 0 && Number.isInteger(total) ? total : undefined,
    meta,
  }, finishedChapter);
}
