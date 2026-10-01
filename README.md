# 128bit

Shows, movies, live TV and audiobooks in one app, powered by **addons**, like Stremio/Nuvio for video and PageTurner for audiobooks. When a stream or book comes as a torrent or web link, 128bit sends it to your **TorBox** account and plays the finished files from there.

| Tab | What it does |
|---|---|
| **Home** | Featured title, Continue watching, Continue listening and top catalogs. |
| **Shows** | Catalogs from Stremio-compatible addons, search, seasons and episodes, then a stream picker (quality/size badges, filters). Subtitles, audio tracks, Next episode / auto-play. |
| **Movies** | Same for movies. |
| **Live TV** | Channels from M3U playlists and Stremio `tv`/`channel` addons, plus a **Sports** section for `sport` addons (Live Now, Today, per sport), with filters and search. |
| **Audiobooks** | **Library** (progress %, Not started / Complete, favourites, filters) and **Downloads** (books saved to the phone). Search for new books from addons, **Pageturner download sources** (send a result to TorBox with one tap), your TorBox cloud or your **Audiobookshelf** server. Chapters inside `.m4b` files, bookmarks with notes, sleep timer (minutes or end of chapter). |
| **Settings** (⚙ top right) | Tracking (Trakt, Hardcover), Layout (accent colour, AMOLED black), Content & Discovery (addons with on/off, reorder, refresh, configure; M3U playlists), Downloads, Playback, Integrations (TorBox), About. |

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
2. In the app: **Settings → Tracking**, paste the Client ID and Client Secret, tap **Save keys**, then **Connect Trakt** and enter the code on trakt.tv/activate.
   (Or bake the keys into the build: repo secrets `TRAKT_CLIENT_ID` / `TRAKT_CLIENT_SECRET`, or `app/.env` locally.)

When connected, what you watch is scrobbled to Trakt, and your Trakt paused items show up in Continue Watching.

### Optional: Hardcover

**Settings → Tracking → Hardcover**: paste your token from <https://hardcover.app/account/api>. Books you listen to are marked Currently Reading with your progress, and Read when you finish. Tap **Hardcover** in the player to fix a wrong match or stop tracking a book.

### Audiobook sources (Pageturner format)

Two kinds, both added in **Settings → Content & Discovery → Audiobook download sources**:

- **Book catalogs** (iTunes, Audible…) fill **Find audiobooks** with Bestsellers, New Releases and genre rows, plus search results. Tap a book to look for it in your download sources.
- **Download sources** (torrent indexes): paste a source URL from <https://pageturner-dsc.elfhosted.com/> (pick a source, tap Copy). Torrent sources are searched when you search in Audiobooks; tap **TorBox** on a result to add it to your TorBox account, then play or download it from **Your TorBox cloud**. Direct-download (HLS) sources aren't supported yet, and some sources only answer the Pageturner app itself.

## Install on your phone

**Easiest:** download the newest APK from the repo's [Releases page](../../releases). Every push that changes `app/` builds a new one automatically (GitHub Actions → *Android APK*).


Expo Go is fine for a quick look, but it can't do background video, picture-in-picture or
reliable lock-screen audio. For the real thing, build the app with EAS (Expo's free cloud
build service, no Android Studio needed):

```bash
cd app
npx eas-cli@latest login          # free Expo account
npx eas-cli@latest init           # links this project to your account (once)
npx eas-cli@latest build -p android --profile preview
```

When the build finishes (about 10–15 minutes) EAS prints a link and QR code. Open it on your
Android phone to download and install the APK. You may need to allow "install unknown apps"
for your browser.

Profiles in `app/eas.json`:

| Profile | What you get |
|---|---|
| `preview` | A normal installable APK. Use this one. |
| `development` | A dev build that loads code live from `npx expo start`, for working on the app. |
| `production` | A Play Store bundle. |

**iPhone:** installing outside the App Store needs an Apple Developer account ($99/year).
Run `npx eas-cli@latest build -p ios --profile preview` and EAS walks you through it.

**Local network:** plain `http://` addresses (a local addon, an Audiobookshelf server, M3U
playlists) are allowed in the app, so `http://192.168.x.x:port` works.

## Ideas for next steps

- Sync progress between devices (Supabase or Firebase)
- EPG (TV guide) for M3U playlists
- Android TV layout

## A note on content

128bit is a player. It doesn't host or provide any content, and it doesn't ship with any addons that link to copyrighted material. Only use addons and sources you have the rights to.
