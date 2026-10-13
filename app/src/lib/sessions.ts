/**
 * Sessions for the 128bit Tracker timeline: each sitting with a movie, episode,
 * audiobook or comic becomes one family event (watch.session / listen.session /
 * read.session) with how long, where you started and stopped, and whether you
 * finished. A session ends when you leave, switch titles, finish, or stay paused
 * for 10 minutes. Short ones (under a minute, unfinished) aren't sent.
 */
import { emitFamilyEvent, type FamilyEvent, type FamilyEventType } from './family';

const IDLE_MS = 10 * 60_000;

type Open = {
  type: FamilyEventType;
  data: FamilyEvent['data'];
  seconds: number;
  fromPct?: number;
  toPct?: number;
  /** Where in the video / audiobook (seconds; chapter for audiobooks), first and last seen. */
  from?: { s: number; ch?: number };
  to?: { s: number; ch?: number };
  finished: boolean;
  chapters: number;
  startedAt: number;
  idle: ReturnType<typeof setTimeout> | null;
};

const open = new Map<string, Open>();

/**
 * Count time on a title. `seconds`: played/read since the last call; `pct`: where
 * you are now (0..100); `pos`: seconds into the video (or the audiobook chapter `ch`);
 * `finished`: you reached the end (or finished a chapter).
 */
export function sessionTick(
  key: string,
  type: FamilyEventType,
  data: FamilyEvent['data'],
  {
    seconds = 0,
    pct,
    pos,
    ch,
    finished = false,
    chapter = false,
  }: { seconds?: number; pct?: number; pos?: number; ch?: number; finished?: boolean; chapter?: boolean },
) {
  // Something else started: the other one's sitting is over.
  for (const k of [...open.keys()]) if (k !== key && open.get(k)!.type === type) sessionEnd(k);
  let s = open.get(key);
  if (!s) {
    s = { type, data, seconds: 0, fromPct: pct, finished: false, chapters: 0, startedAt: Date.now(), idle: null };
    open.set(key, s);
  }
  s.data = { ...s.data, ...data };
  s.seconds += Math.max(0, seconds);
  if (pct != null && Number.isFinite(pct)) {
    if (s.fromPct == null) s.fromPct = pct;
    s.toPct = pct;
  }
  if (pos != null && Number.isFinite(pos)) {
    const at = { s: Math.round(pos), ch };
    if (!s.from) s.from = at;
    s.to = at;
  }
  if (chapter) s.chapters += 1;
  if (finished) s.finished = true;
  if (s.idle) clearTimeout(s.idle);
  s.idle = setTimeout(() => sessionEnd(key), IDLE_MS);
}

/** Close a sitting and put it on the timeline. */
export function sessionEnd(key: string) {
  const s = open.get(key);
  if (!s) return;
  open.delete(key);
  if (s.idle) clearTimeout(s.idle);
  if (s.seconds < 60 && !s.finished && !s.chapters) return;
  const round = (n?: number) => (n == null ? undefined : Math.max(0, Math.min(100, Math.round(n))));
  emitFamilyEvent(s.type, {
    ...s.data,
    minutes: Math.max(1, Math.round(s.seconds / 60)),
    from_pct: round(s.fromPct),
    to_pct: s.finished && s.type !== 'read.session' ? 100 : round(s.toPct),
    finished: s.finished ? 1 : undefined,
    chapters: s.chapters || undefined,
    // Where you started and stopped inside it, so a stream that drops can be picked up again.
    from_s: s.from?.s,
    to_s: s.to?.s,
    from_chapter: s.from?.ch != null ? s.from.ch + 1 : undefined,
    to_chapter: s.to?.ch != null ? s.to.ch + 1 : undefined,
    started_at: new Date(s.startedAt).toISOString(),
  }).catch(() => {});
}
