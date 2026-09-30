# 128bit

A Stremio-style audiobook app. You install **addons** (JSON endpoints) that list audiobooks. When a book comes as a torrent or a web link, 128bit sends it to your **TorBox** account and then streams the finished files from there, or saves them to your phone for offline listening.

```
┌──────────── 128bit app (Expo / React Native) ────────────┐
│ Discover · Library · Addons · Settings · Player          │
│        │                     │                           │
│  Addon client            TorBox client                   │
└────────┼─────────────────────┼───────────────────────────┘
         │ JSON                │ api.torbox.app
   manifest.json          createtorrent / createwebdownload
   /catalog/…json         mylist  → requestdl (direct link)
   /book/…json
```

## What's in here

| Path | What it is |
|---|---|
| [`app/`](app) | The mobile app (Expo SDK 57, iOS, Android and web) |
| [`addons/librivox/`](addons/librivox) | Example addon: free public-domain LibriVox audiobooks from archive.org |
| [`docs/ADDON_PROTOCOL.md`](docs/ADDON_PROTOCOL.md) | The addon JSON format, if you want to write your own |

## Features in this starter

- **Addons:** install by manifest URL, browse catalogs, search, view book details and sources.
- **TorBox:** API key kept in the device's secure storage. Torrents (`infoHash`/`magnet`) and web links (`webUrl`) are sent to TorBox, the app shows download progress, then turns the audio files into chapters. Stream links are requested fresh at play time because TorBox links expire.
- **Library:** Continue listening, books saved on this phone, and everything with audio in your TorBox cloud (even items you added outside the app).
- **Player:** runs app-wide with a mini player, background playback and lock-screen controls. Includes ±30s skip, next/previous chapter, speed 0.8–2×, a sleep timer, auto-advance, and resume from where you left off.
- **Offline:** download every chapter to the phone and play it without a connection.

## Run it

### 1. Start the example addon

```bash
cd addons/librivox
node server.js            # → http://localhost:7000/manifest.json
```

Your phone can't reach `localhost`, so use your computer's LAN IP, e.g. `http://192.168.1.20:7000/manifest.json`. You can also deploy the addon anywhere that runs Node (Render, Railway, Fly.io, a VPS).

### 2. Start the app

```bash
cd app
npm install
npx expo start
```

Scan the QR code with **Expo Go** on your phone, or press `w` to open it in a browser.

### 3. In the app

1. **Settings** → paste your TorBox API key (from torbox.app/settings) → **Save & test**.
2. **Addons** → paste the addon's manifest URL → **Install**.
3. **Discover** → pick a book → pick a source:
   - **Direct stream** plays straight away.
   - **Torrent → TorBox** sends it to TorBox, shows progress, then plays the files.

## Building a real app

Expo Go is fine for development. For an installable APK/IPA with full background audio:

```bash
cd app
npx eas-cli@latest build --profile preview --platform android
```

## Ideas for next steps

- Chapter markers inside single-file `.m4b` books
- Sync progress between devices (Supabase or Firebase)
- Movies and TV: add a video player and Stremio-compatible `meta`/`stream` addons alongside audiobooks
- Android TV layout

## A note on content

128bit is a player. It doesn't host or provide any content, and it doesn't ship with any addons that link to copyrighted material. Only use addons and sources you have the rights to.
