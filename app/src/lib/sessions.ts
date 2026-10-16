/**
 * Sessions for the 128bit Tracker timeline: each sitting with a movie, episode,
 * audiobook or comic becomes one family event (watch.session / listen.session /
 * read.session) with how long, where you started and stopped, and whether you
 * finished. A session ends when you leave, switch titles, finish, or stay paused
 * for 10 minutes. Short ones (under a minute, unfinished) aren't sent.
 *
 * How long a sitting was comes from *where you were*, not only from timers: Android
 * stops the app's JavaScript timers while the screen is off, so an audiobook can
 * play for an hour with only a few ticks counted. Each call here is a "sample"
 * (position + chapter + wall clock), and the time between two samples is the
 * position difference — capped by the real time that passed (see `credit`). The
 * tick seconds callers pass are a fallback: a sitting is never shorter than them.
 *
 * Open sittings are kept on the phone (AsyncStorage) as they go, so if Android
 * kills the app they're sent on the next launch, and a long sitting is checkpointed
 * about once an hour under the same event id (the timeline still shows one line).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import { emitFamilyEvent, newEventId, type FamilyEvent, type FamilyEventType } from './family';

const IDLE_MS = 10 * 60_000;
const CHECKPOINT_MS = 60 * 60_000;
const STORE_KEY = '128bit.sessions.open';
const PERSIST_EVERY_MS = 15_000;

/** One look at the player: where it is and whether it's going. */
type Sample = { s: number; ch?: number; at: number; playing: boolean; rate: number };

type Open = {
  /** The family event id; checkpoints and the final line share it. */
  id: string;
  type: FamilyEventType;
  data: FamilyEvent['data'];
  /** Time counted by the caller's ticks (the fallback). */
  tickSeconds: number;
  /** Time worked out from position changes between samples. */
  posSeconds: number;
  fromPct?: number;
  toPct?: number;
  /** Where in the video / audiobook (seconds; chapter for audiobooks), first and last seen. */
  from?: { s: number; ch?: number };
  to?: { s: number; ch?: number };
  /** The last sample, to measure the next one against. */
  last?: Sample;
  /** The next sample only sets a new starting point (after a seek / jump). */
  reanchor?: boolean;
  /** Known chapter lengths (seconds), by chapter index. */
  durs: Record<number, number>;
  finished: boolean;
  chapters: number;
  startedAt: number;
  /** Wall time of the last thing that happened (sample or tick). */
  lastAt: number;
  checkpointAt: number;
};

const open = new Map<string, Open>();
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** What a sitting counts as: position-based time, never less than tick time. */
const credited = (s: Open) => Math.max(s.tickSeconds, s.posSeconds);

// --- Probes: a way to look at the player when a timer fires late --------------------

export type ProbeResult = { pos: number; ch?: number; dur?: number; playing: boolean; rate?: number } | null;
const probes = new Map<FamilyEventType, (key: string) => ProbeResult>();

/**
 * Lets the idle timer (and coming back to the app) ask the player where it is before
 * calling a sitting over — after the screen was off, the 10-minute timer fires the
 * moment the app wakes up, even though the book kept playing all along.
 */
export function registerSessionProbe(type: FamilyEventType, probe: (key: string) => ProbeResult) {
  probes.set(type, probe);
}

// --- Statistics: told about every second a sitting gains ----------------------------

const timeListeners = new Map<FamilyEventType, (key: string, seconds: number) => void>();

/**
 * Called with the seconds a sitting gains, however they were found (ticks, positions,
 * a look at the player after the screen was off) — so Play's own statistics add up to
 * exactly what the timeline shows.
 */
export function onSessionTime(type: FamilyEventType, fn: (key: string, seconds: number) => void) {
  timeListeners.set(type, fn);
}

function told(key: string, type: FamilyEventType, seconds: number) {
  if (seconds > 0) timeListeners.get(type)?.(key, seconds);
}

/** Look at the player outside a tick; count what it played meanwhile. */
function probeSample(key: string, s: Open, r: NonNullable<ProbeResult>) {
  const before = credited(s);
  const now = sample(key, s, r);
  told(key, s.type, Math.max(0, credited(s) - before) + (now === s ? 0 : credited(now)));
}

// --- Keeping open sittings on the phone ---------------------------------------------

let lastPersist = 0;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Sittings left open by the last run (app killed): sent once, before anything new is saved. */
const recovered: Promise<void> = (async () => {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    const left = raw ? (JSON.parse(raw) as [string, Open][]) : [];
    for (const [, s] of left) send({ ...s, durs: s.durs ?? {} });
    if (left.length) await AsyncStorage.removeItem(STORE_KEY);
  } catch {
    // nothing saved (or unreadable)
  }
})();

function persist(now = false) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  const write = () => {
    lastPersist = Date.now();
    recovered
      .then(() =>
        open.size
          ? AsyncStorage.setItem(STORE_KEY, JSON.stringify([...open.entries()]))
          : AsyncStorage.removeItem(STORE_KEY),
      )
      .catch(() => {});
  };
  if (now || Date.now() - lastPersist >= PERSIST_EVERY_MS) write();
  else persistTimer = setTimeout(write, PERSIST_EVERY_MS);
}

// Going to the background: save now (Android may kill the app any time after this).
// Coming back: look at the players, so a sitting that went on with the screen off counts.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    for (const [key, s] of [...open.entries()]) {
      const r = probes.get(s.type)?.(key);
      if (r) probeSample(key, s, r);
    }
    persist(true);
  } else if (state === 'background') {
    persist(true);
  }
});

// --- Position → time ----------------------------------------------------------------

/**
 * Seconds of the title that played between two samples (position time, before speed),
 * across chapters when their lengths are known. Backwards (a rewind) counts nothing.
 */
function positionDelta(s: Open, a: Sample, b: { s: number; ch?: number }) {
  const ca = a.ch ?? 0;
  const cb = b.ch ?? 0;
  if (cb === ca) return Math.max(0, b.s - a.s);
  if (cb < ca) return 0;
  // Later chapter: the rest of the old one, the ones in between, then into the new one.
  let d = b.s;
  const rest = s.durs[ca];
  if (rest != null) d += Math.max(0, rest - a.s);
  for (let c = ca + 1; c < cb; c++) d += s.durs[c] ?? 0;
  return d;
}

/**
 * Real time credited for the gap between the last sample and this one.
 *
 * Position delta ÷ speed is how long it took to hear/see that much (at 1.5× an hour
 * of book is 40 real minutes). That's capped by the wall time that actually passed,
 * so a seek forward doesn't count as listening. Speed is the one at the last sample;
 * if it changed in between, the cap keeps the result sensible either way. A gap
 * that started paused counts nothing (we sample on play/pause, so the play sample
 * starts the next gap).
 */
function credit(s: Open, b: { s: number; ch?: number; at: number }) {
  const a = s.last;
  if (!a || s.reanchor || !a.playing) return { secs: 0, wall: a ? (b.at - a.at) / 1000 : 0 };
  const wall = Math.max(0, (b.at - a.at) / 1000);
  const played = positionDelta(s, a, b) / (a.rate > 0 ? a.rate : 1);
  return { secs: Math.min(played, wall), wall };
}

function sample(
  key: string,
  s: Open,
  r: { pos: number; ch?: number; dur?: number; playing: boolean; rate?: number },
  at = Date.now(),
): Open {
  if (r.dur != null && Number.isFinite(r.dur) && r.dur > 0) s.durs[r.ch ?? 0] = r.dur;
  const { secs, wall } = credit(s, { s: r.pos, ch: r.ch, at });
  // Away (paused or stopped) for 10 minutes or more since the last sample: that sitting
  // ended back then, and this one starts here.
  if (s.last && wall - secs >= IDLE_MS / 1000) {
    s.posSeconds += secs;
    if (secs > 0) s.to = { s: Math.round(r.pos), ch: r.ch };
    finish(key, s.last.at + secs * 1000);
    s = start(key, s.type, s.data, at);
  } else {
    s.posSeconds += secs;
  }
  const point = { s: Math.round(r.pos), ch: r.ch };
  if (!s.from) s.from = point;
  s.to = point;
  s.last = { s: r.pos, ch: r.ch, at, playing: r.playing, rate: r.rate ?? 1 };
  s.reanchor = false;
  s.lastAt = at;
  return s;
}

function start(key: string, type: FamilyEventType, data: FamilyEvent['data'], at = Date.now()): Open {
  const s: Open = {
    id: newEventId(),
    type,
    data,
    tickSeconds: 0,
    posSeconds: 0,
    durs: {},
    finished: false,
    chapters: 0,
    startedAt: at,
    lastAt: at,
    checkpointAt: at,
  };
  open.set(key, s);
  return s;
}

function armIdle(key: string) {
  const t = idleTimers.get(key);
  if (t) clearTimeout(t);
  idleTimers.set(
    key,
    setTimeout(() => {
      idleTimers.delete(key);
      const s = open.get(key);
      if (!s) return;
      // Timers stop while the screen is off; ask the player before calling it over.
      const r = probes.get(s.type)?.(key);
      const moved = !!r && (!s.last || r.pos !== s.last.s || r.ch !== s.last.ch);
      if (r && (r.playing || moved)) {
        // Still going (or it went on while we weren't looking): count it, look again later.
        probeSample(key, s, r);
        armIdle(key);
        persist();
        return;
      }
      sessionEnd(key);
    }, IDLE_MS),
  );
}

/**
 * Count time on a title. `seconds`: played/read since the last call (tick time, the
 * fallback); `pct`: where you are now (0..100); `pos`: seconds into the video (or the
 * audiobook chapter `ch`, whose length is `dur`); `rate`: playback speed; `playing`:
 * whether it's going right now (pass false on pause); `jumped`: you're about to seek,
 * so the next position starts fresh; `finished`: you reached the end (or finished a
 * chapter). Returns the seconds this call added to the sitting (for statistics).
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
    dur,
    rate,
    playing = true,
    jumped = false,
    finished = false,
    chapter = false,
  }: {
    seconds?: number;
    pct?: number;
    pos?: number;
    ch?: number;
    dur?: number;
    rate?: number;
    playing?: boolean;
    jumped?: boolean;
    finished?: boolean;
    chapter?: boolean;
  },
): number {
  // Something else started: the other one's sitting is over.
  for (const k of [...open.keys()]) if (k !== key && open.get(k)!.type === type) sessionEnd(k);
  const prev = open.get(key) ?? start(key, type, data);
  const before = credited(prev);
  let s = prev;
  s.data = { ...s.data, ...data };
  s.tickSeconds += Math.max(0, seconds);
  if (pos != null && Number.isFinite(pos)) s = sample(key, s, { pos, ch, dur, playing, rate });
  else s.lastAt = Date.now();
  if (jumped) s.reanchor = true;
  if (pct != null && Number.isFinite(pct)) {
    if (s.fromPct == null) s.fromPct = pct;
    s.toPct = pct;
  }
  if (chapter) s.chapters += 1;
  if (finished) s.finished = true;
  // Seconds added: to this sitting, or (if a long pause just split it) to both.
  const added = Math.max(0, credited(prev) - before) + (s === prev ? 0 : credited(s));
  told(key, type, added);
  // Long sitting: send what there is so far (same id — the final line replaces it).
  if (Date.now() - s.checkpointAt >= CHECKPOINT_MS) {
    s.checkpointAt = Date.now();
    send(s);
  }
  armIdle(key);
  persist(finished || !playing || jumped);
  return added;
}

function payload(s: Open): FamilyEvent['data'] {
  const round = (n?: number) => (n == null ? undefined : Math.max(0, Math.min(100, Math.round(n))));
  return {
    ...s.data,
    minutes: Math.max(1, Math.round(credited(s) / 60)),
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
  };
}

/** Put a sitting on the timeline (unless it's too short to matter). */
function send(s: Open, at = s.lastAt) {
  if (credited(s) < 60 && !s.finished && !s.chapters) return;
  emitFamilyEvent(s.type, payload(s), { id: s.id, at }).catch(() => {});
}

function finish(key: string, at?: number) {
  const s = open.get(key);
  if (!s) return;
  open.delete(key);
  const t = idleTimers.get(key);
  if (t) clearTimeout(t);
  idleTimers.delete(key);
  send(s, at ?? s.lastAt);
}

/** Close a sitting and put it on the timeline. */
export function sessionEnd(key: string) {
  finish(key);
  persist(true);
}
