# 128bit

Shows, movies, live TV and audiobooks in one app, powered by **addons**, like Stremio/Nuvio for video and PageTurner for audiobooks. When a stream or book comes as a torrent or web link, 128bit sends it to your **TorBox** account and plays the finished files from there.

| Tab | What it does |
|---|---|
| **Shows** | Catalogs from Stremio-compatible addons, search, seasons and episodes, then a stream picker. Continue watching. |
| **Movies** | Same for movies. |
| **Live TV** | Channels from M3U playlists and Stremio `tv` addons, with group filters and search. |
| **Audiobooks** | **Library** (progress %, Not started / Complete, favourites, filters) and **Downloads** (books saved to the phone). Search icon for finding new books. |
| **Settings** | Tracking (Trakt), Layout (accent colour, AMOLED black), Content & Discovery (addons with on/off, reorder, refresh, configure; M3U playlists), Downloads, Playback, Integrations (TorBox), About. |

Shows, Movies and Live TV only stream. Audiobooks can stream or download.

```
┌──────────── 128bit app (Expo / React Native) ─────────────┐
│ Shows · Movies · Live TV · Audiobooks · Settings          │
│        │                     │                            │
│  Addon client            TorBox client                    │
└────────┼─────────────────────┼────────────────────────────┘
         │ JSON                │ api.torbox.app
   Stremio: /catalog /meta /stream    createtorrent → mylist → requestdl
   128bit:  /catalog /book (audiobooks)
   M3U playlists (live TV)
```

## What's in here

| Path | What it is |
|---|---|
| [`app/`](app) | The mobile app (Expo SDK 57, iOS, Android and web) |
| [`addons/librivox/`](addons/librivox) | Example addon: free public-domain LibriVox audiobooks from archive.org |
| [`docs/ADDON_PROTOCOL.md`](docs/ADDON_PROTOCOL.md) | The addon JSON format, if you want to write your own |

## How streams are played

- `url` → played directly (HLS `.m3u8` and MP4/MKV, depending on the phone).
- `infoHash` → added to TorBox. If TorBox already has it cached (⚡ badge) it starts right away; otherwise the app shows progress and plays when it's ready.
- `externalUrl` → opened outside the app.

Movies and episodes remember where you stopped (Continue watching). Audiobooks remember chapter and position, show overall progress, can be favourited, and play in the background with lock-screen controls.

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

1. **Settings → Integrations** → paste your TorBox API key (from torbox.app/settings) → **Save & test**.
2. **Settings → Content & Discovery → Addons**:
   - Tap **Install** on the suggested **Cinemeta** for movie and show catalogs.
   - Paste any Stremio-compatible stream addon's manifest URL.
   - Paste the audiobook addon URL, e.g. `http://<your-computer-ip>:7000/manifest.json`.
   - Optionally add an M3U playlist for Live TV (**Content & Discovery → Live TV playlists**).
3. **Shows / Movies** → pick a title → pick a stream. **Audiobooks** → 🔍 → pick a book → pick a source.

### Optional: Trakt

1. Create an app at <https://trakt.tv/oauth/applications> with redirect URI `urn:ietf:wg:oauth:2.0:oob`.
2. Copy `app/.env.example` to `app/.env` and fill in the client ID and secret.
3. Restart `npx expo start`, then go to **Settings → Tracking → Connect Trakt**. Enter the code shown on trakt.tv/activate.

When connected, what you watch is scrobbled to Trakt, and your Trakt paused items show up in Continue Watching.

## Building a real app

Expo Go is fine for development. For an installable APK/IPA with full background audio:

```bash
cd app
npx eas-cli@latest build --profile preview --platform android
```

## Ideas for next steps

- Chapter markers inside single-file `.m4b` books
- Sync progress between devices (Supabase or Firebase)
- Subtitles (Stremio `subtitles` resource) and audio track picker
- EPG (TV guide) for M3U playlists
- Android TV layout

## A note on content

128bit is a player. It doesn't host or provide any content, and it doesn't ship with any addons that link to copyrighted material. Only use addons and sources you have the rights to.
