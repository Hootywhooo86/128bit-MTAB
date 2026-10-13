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

export type FamilyEventType = 'book.finished' | 'movie.watched' | 'episode.watched' | 'chapter.read';

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

export async function emitFamilyEvent(type: FamilyEventType, data: FamilyEvent['data']) {
  const q = await load();
  q.push({ id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, app: 'play', type, at: Date.now(), data });
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
