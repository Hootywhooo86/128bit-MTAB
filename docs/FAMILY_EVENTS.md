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
  "data": { "show": "Severance", "episode": "S2E3 · Who Is Alive?" }
}
```

| Field | Meaning |
|---|---|
| `id` | Unique per event (per account). Sending it twice does nothing. |
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

Live TV sends nothing.

## How it travels

- Events wait on the phone (`128bit.family.queue`, newest 500) and go up a few seconds after they
  happen, when signed in. Signed out or offline, they wait.
- `log_events(events jsonb)` inserts a batch; duplicates (same `id`) are ignored.
- `get_events(before_ms bigint, max_rows int)` returns the newest events first, up to 1000; pass the
  oldest `at` you have as `before_ms` for the next page.
- A paired TV writes to its owner's feed, like its settings.

Existing accounts: run the setup SQL again (Settings → Account → Copy setup SQL). It only adds
what's missing.
