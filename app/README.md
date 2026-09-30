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
  app/                  routes (Expo Router)
    (tabs)/             Discover · Library · Addons · Settings
    book.tsx            addon book → pick a source
    cloud/[kind]/[id]   a TorBox cloud item as a book
    player.tsx          full-screen player
  components/           UI pieces, mini player, chapter list
  lib/
    addons.ts           addon protocol client
    torbox.ts           TorBox API client
    resolve.ts          source → playable chapters (direct or via TorBox)
    player.tsx          app-wide audio player (expo-audio)
    downloads.ts        offline storage (expo-file-system)
    storage.ts          settings, progress, recents
```
