/**
 * The 128bit family event feed. When you finish something here (a book, a movie, an
 * episode, a comic chapter) an event goes to your account's Supabase project, and
 * 128bit Tracker shows it on its timeline. Schema: docs/FAMILY_EVENTS.md.
 *
 * Events wait on the phone until you're signed in and the setup SQL has the feed
 * (Settings → Account → Copy setup SQL), then go up a few seconds after they happen.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { getSession, isSignedIn, onAccount, rpc } from './account';

const QUEUE_KEY = '128bit.family.queue';
const MAX_QUEUED = 500;

export type FamilyEventType =
  | 'book.finished'
  | 'movie.watched'
  | 'episode.watched'
  | 'chapter.read'
  /** One sitting: { minutes, from_pct, to_pct, finished?, started_at, … } (lib/sessions.ts). */
  | 'watch.session'
  | 'listen.session'
  | 'read.session';

export type FamilyEvent = {
  /** Unique per event, so a retried send never doubles up. */
  id: string;
  app: 'play';
  type: FamilyEventType;
  /** ms since 1970. */
  at: number;
  data: Record<string, string | number | undefined>;
};

let queue: FamilyEvent[] | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let sending: Promise<void> | null = null;

async function load() {
  if (queue) return queue;
  try {
    queue = JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) ?? '[]') as FamilyEvent[];
  } catch {
    queue = [];
  }
  return queue;
}

const save = (q: FamilyEvent[]) => AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q)).catch(() => {});

/**
 * Ids and episode numbers for a watched movie/episode, from its key
 * ("tt0078748", "tt11280740:1:3", "kitsu:46474:5"), so 128bit Tracker files it
 * under the right title and season and knows when the season is done.
 */
export function watchedDetails(
  key: string,
  opts: { series?: { episodes: { id: string }[] }; anime?: boolean; poster?: string } = {},
): Record<string, string | number | undefined> {
  const out: Record<string, string | number | undefined> = {};
  const imdb = key.match(/^(tt\d+)(?::(\d+):(\d+))?$/);
  const kitsu = key.match(/^kitsu:(\d+)(?::(\d+))?$/);
  if (imdb) {
    out.imdb = imdb[1];
    if (imdb[2]) {
      out.season = Number(imdb[2]);
      out.number = Number(imdb[3]);
      const inSeason = (opts.series?.episodes ?? []).filter((e) => e.id.split(':')[1] === imdb[2]).length;
      if (inSeason) out.season_episodes = inSeason;
    }
  } else if (kitsu) {
    out.kitsu = Number(kitsu[1]);
    if (kitsu[2]) {
      out.season = 1;
      out.number = Number(kitsu[2]);
      const count = opts.series?.episodes.length;
      if (count) out.season_episodes = count;
    }
  }
  if (opts.anime) out.anime = 1;
  if (opts.poster) out.poster = opts.poster;
  return out;
}

export const newEventId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Queue an event. `id`: reuse one to replace an earlier event (a sitting's hourly checkpoint
 * and its final line share an id, so the timeline shows one line); `at`: when it happened.
 */
export async function emitFamilyEvent(
  type: FamilyEventType,
  data: FamilyEvent['data'],
  { id = newEventId(), at = Date.now() }: { id?: string; at?: number } = {},
) {
  const q = await load();
  const same = q.findIndex((e) => e.id === id);
  if (same >= 0) q.splice(same, 1);
  q.push({ id, app: 'play', type, at, data });
  if (q.length > MAX_QUEUED) q.splice(0, q.length - MAX_QUEUED);
  await save(q);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    flushFamilyEvents();
  }, 3000);
}

/** Sends what's waiting. Quietly keeps it for later when signed out or offline. */
export function flushFamilyEvents(): Promise<void> {
  sending ??= (async () => {
    const q = await load();
    if (!q.length || !isSignedIn(await getSession())) return;
    const batch = q.slice(0, 100);
    await rpc('log_events', { events: batch });
    const sent = new Set(batch.map((e) => e.id));
    queue = q.filter((e) => !sent.has(e.id));
    await save(queue);
    if (queue.length) setTimeout(flushFamilyEvents, 0);
  })()
    .catch(() => {})
    .finally(() => {
      sending = null;
    });
  return sending;
}

// Signing in, or a sync finishing, is a good moment to send what waited.
onAccount(() => {
  flushFamilyEvents();
});
