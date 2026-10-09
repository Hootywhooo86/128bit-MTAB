# 128bit family kit

The same folder lives in every 128bit app. It's what makes them one family:

| File | What it holds |
| --- | --- |
| `tokens.ts` | The pixel font (PressStart2P), the black-and-grey neutrals, the fixed data colours |
| `accent.ts` | Accent presets and the rules for a custom one (no red, must read on black) |
| `apps.ts` | Every family app: name, URL scheme, Android package, `appLink()` |
| `open.ts` | `openFamilyApp()` — opens a sibling, or returns one sentence saying why it couldn't |
| `events.ts` | The shared event schema and XP table that 128bitlife will collect |

## Rules

- **The files are identical in every repo.** Change one, copy it to all of them in
  the same sitting, and bump `FAMILY_VERSION` in `tokens.ts`.
- Files import only each other and `react-native` (in `open.ts`), so the folder can
  be dropped into any app unchanged. `open.ts` is left out of `index.ts` so pure code
  and test runners can import the rest without React Native.
- Monochrome UI. Colour only means data. The accent is user-picked and free,
  permanently, and is never a data colour.
- PressStart2P for headers, section labels and tab labels. Body text is each app's own.

## Where it lives

| App | Path |
| --- | --- |
| 128bitfit | `lib/family/` |
| 128bitPlay | `app/src/family/` |
| 128bittrip | `app/src/family/` |
