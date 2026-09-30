# 128bit app

Expo (SDK 57) app. See the [root README](../README.md) for the overview and setup.

```bash
npm install
npx expo start      # dev server (Expo Go / web)
npm run typecheck   # tsc --noEmit
npm run lint        # expo lint
```

## Layout

```
src/
  app/                    routes (Expo Router)
    (tabs)/               Shows · Movies · Live TV · Audiobooks · Settings
    title.tsx             movie/show details, seasons and episodes
    streams.tsx           stream picker for one episode
    watch.tsx             full-screen video player (expo-video)
    addons.tsx            install addons and M3U playlists
    audiobooks/browse     find audiobooks from addons
    audiobooks/cloud      audiobooks in your TorBox
    book.tsx              addon book → pick a source
    cloud/[kind]/[id]     a TorBox cloud item as a book
    player.tsx            full-screen audiobook player
  components/             UI pieces, mini player, rows, stream list
  lib/
    addons.ts             Stremio + 128bit addon client
    torbox.ts             TorBox API client
    video.ts              stream → playable URL, continue watching
    m3u.ts                M3U playlist parser
    resolve.ts            audiobook source → chapters
    player.tsx            app-wide audiobook player (expo-audio)
    downloads.ts          offline audiobooks (expo-file-system)
    storage.ts            settings, library, favourites, progress
```
