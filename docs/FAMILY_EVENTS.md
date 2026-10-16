# 128bit family events

128bitPlay posts what you finish to a shared event feed, and **128bit Tracker** reads it to show
everything on one timeline. The feed lives in the same Supabase project as your account
(Settings → Account), in the `family_events` table created by the setup SQL. The same schema is
in 128bittracker's `docs/EVENTS.md` and `src/events.ts`; keep them in step.

## Event

```json
{
  "id": "lq3k9z1-4f8a2c1b",
  "app": "play",
  "type": "episode.watched",
  "at": 1791427200000,
  "data": { "show": "Severance", "episode": "S2 E3 · Who Is Alive?" }
}
```

| Field | Meaning |
|---|---|
| `id` | Unique per event (per account). Sending it again replaces the event. |
| `app` | Which 128bit app sent it: `play`, `tracker`, `fit`, `gold`, `music`, `fantasy`, `trip`, `life`. |
| `type` | `noun.verb`, past tense. |
| `at` | When it happened, ms since 1970. |
| `data` | Small, display-ready fields for that type. |

## What 128bitPlay sends

| `type` | When | `data` |
|---|---|---|
| `book.finished` | An audiobook plays to the end (once per book) | `title`, `author` |
| `movie.watched` | A movie is watched to near the end (once per movie) | `title` |
| `episode.watched` | An episode is watched to near the end (once per episode) | `show`, `episode` |
| `chapter.read` | The last page of a comic chapter | `comic` |
| `watch.session` | A sitting with a movie or episode ends (you leave, switch, finish, or stay paused 10 min); at least a minute or finished | `kind` (`movie`/`episode`), `title` or `show` + `episode`, `imdb`/`kitsu`, `season`, `number`, `minutes`, `from_pct`, `to_pct`, `from_s`, `to_s` (seconds into the video), `finished`, `started_at` |
| `listen.session` | Same, for an audiobook | `title`, `author`, `minutes`, `from_pct`, `to_pct`, `from_chapter` + `from_s`, `to_chapter` + `to_s` (where in the book), `finished`, `started_at` |
| `read.session` | Same, for a comic (ends after a switch or 10 min without a page turn) | `comic`, `chapter` (the last one), `chapters` (finished this sitting), `minutes`, `started_at` |

Live TV sends nothing.

### How a sitting's `minutes` are worked out (`app/src/lib/sessions.ts`)

- **From positions.** Play looks at where you are (seconds into the video, or chapter + seconds
  into an audiobook) every ~10 s while playing, on play/pause, before and after a seek or chapter
  jump, when a file ends, when the app comes back to the foreground, and when the idle timer fires.
  The time between two looks is the position difference (summed across chapters with their lengths
  when known) **divided by the playback speed**, **capped by the wall-clock time** that passed. So
  an hour of book at 1.5× is 40 minutes; a seek forward never counts as listening; and an hour
  played with the screen off (when the app's timers don't run) still counts in full once the app
  next looks. A gap that started paused counts nothing.
- **Tick fallback.** The players also count seconds while their timers run; a sitting is never
  shorter than that (and it's all there is for comics, which have no position).
- **One sitting, one line.** Pauses and chapter changes don't split it. It ends when you switch
  titles, finish, leave the video, or nothing plays for 10 minutes (a gap of 10+ minutes not
  covered by position, even one only noticed later, closes the earlier sitting at its last moment).
- **Checkpoints.** A sitting is saved on the phone as it goes (`128bit.sessions.open`); if the app
  is killed, it's sent on the next launch. A sitting longer than an hour is sent about once an hour
  so far, **under the same event `id`** — the final event replaces the checkpoint, so the timeline
  still shows one line.
- Play's own Statistics ("time listened" / "time watched") are credited from exactly these minutes.
- `from_s`/`to_s` (and `from_chapter`/`to_chapter`, 1-based, for audiobooks) are always set for
  audiobooks and videos; `to_*` is where the sitting stopped (the end of the file when finished).
- `at` is when the sitting stopped (or the checkpoint), `started_at` when it began.

## How it travels

- Events wait on the phone (`128bit.family.queue`, newest 500) and go up a few seconds after they
  happen, when signed in. Signed out or offline, they wait.
- The feed's SQL is part of the setup SQL (Settings → Account → Copy setup SQL), and the same
  block is 128bittracker's `supabase/family.sql`. Keep them in step.
- `log_events(events jsonb)` adds a batch; the same `id` again replaces the event (Play relies on
  this for sitting checkpoints, and also replaces a still-queued event with the same `id`).
  `get_events(before_ms, max_rows)` reads newest first; `delete_event(event_id)` removes one.
- Other apps post there too: 128bitfit (workouts, Health Connect totals), Tracker's own
  "Log anything", and outside apps with a personal key (`log_events_with_key`). Full list:
  128bittracker's `docs/EVENTS.md`.
- 128bit Tracker also reads the Trakt connection saved here (Settings → Tracking, synced to the
  account) to show your Trakt history. It only reads it; it never refreshes the Trakt sign-in, so
  this app's stays valid. (Play no longer talks to Hardcover; audiobooks go to Tracker's
  Audiobooks list instead.)
- A paired TV writes to its owner's feed.

Existing accounts: run the setup SQL again. It only adds what's missing.
