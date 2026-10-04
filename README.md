# 128bitPlay

Audiobooks, shows, movies, anime, live TV and comics in one app, powered by **addons**, like Stremio/Nuvio for video and PageTurner for audiobooks. When a stream or book comes as a torrent or web link, 128bit sends it to your **TorBox** account and plays the finished files from there.

The bottom row is **Books · Shows · Movies · Anime · Live TV · Comics**; the app opens on Books.

| Tab | What it does |
|---|---|
| **Shows** | Catalogs from Stremio-compatible addons, search, seasons and episodes, then a stream picker (quality/size badges, filters). Subtitles, audio tracks, Next episode / auto-play. |
| **Movies** | Same for movies. |
| **Anime** | Anime catalogs (Kitsu addon), episodes and streams, like Shows. |
| **Live TV** | Channels from M3U playlists and Stremio `tv`/`channel` addons, plus a **Sports** section for `sport` addons (Live Now, Today, per sport), with filters and search. |
| **Audiobooks** | **Library** (progress %, Not started / Complete, favourites, filters), **Downloads** (books saved to the phone) and **Wanted** (books you want, auto-matched on AudiobookBay). Search for new books from addons, **Pageturner download sources** (send a result to TorBox with one tap), your TorBox cloud or your **Audiobookshelf** server. Chapters inside `.m4b` files, bookmarks with notes, sleep timer (minutes or end of chapter). |
| **Comics** | **Library**: only comics on the phone (downloaded, grabbed or imported), last read first, plus Import CBZ/CBR. **Find**: GetComics + Pirate Bay (tap **Get**), MangaDex and your Suwayomi sources (open one and download chapters). **Wanted**: where each grabbed comic is, and new issues of series you follow. Reader with scroll-down or page-turn modes, data saver, read marks and next chapter. |
| **Settings** (⚙ top right) | Tracking (Trakt, Simkl, Hardcover), **Statistics** (listening/watching time, last 7 days, books finished, movies and episodes watched, chapters read), Layout (accent colour, AMOLED black), Content & Discovery (addons with on/off, reorder, refresh, configure; M3U playlists), Downloads, Playback, Integrations (TorBox, TMDB, MDBList, Audiobookshelf), About. |

Streams appear addon by addon as each answers (a slow addon is skipped after 15 s; lists are kept 10 minutes). Filter by quality, and by provider (addons and the torrent sites they found, e.g. ThePirateBay, EZTV). In Continue watching, hold an item to remove it. Tap a stream to play it; **hold a stream to download** it to the phone (direct links download at once; torrents go to TorBox and download when ready). **Settings → Downloads** has Movies, TV (grouped by show) and Audiobooks, with progress, pause/resume, play and delete; a downloaded title shows **Play downloaded**. Live TV only streams.

Anime catalogs that addons label as ordinary shows or movies (Kitsu, Crunchyroll, "… Anime") are shown in the **Anime** tab instead of Shows/Movies.

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

When connected, 128bit reads and writes your whole Trakt account:

- **Scrobbling** while you watch, and Trakt's paused items in Continue Watching.
- **Trakt library** (Settings → Tracking → Open Trakt library, or the link on the Shows/Movies rows): Up next, Watchlist, History, Collection, Ratings, Favorites, personal Lists (create, delete, open, remove items), Calendar (your shows' next 30 days), For you (recommendations, with Not interested), Paused (playback progress) and Stats.
- **Title pages**: Watchlist, Watched (movie) / Mark all (show), Collection, Favorite, Rate 1–10, add to your Lists, Check in.
- **Episodes**: watched marks from Trakt; hold an episode to mark it watched or unwatched.
- **Shows / Movies tabs**: Up next on Trakt and Your Trakt watchlist rows.

### RSS feeds (new uploads)

**Find audiobooks → New on AudiobookBay** lists the newest posts from an RSS feed (AudiobookBay's `/rss` is added by default; add more in **Settings → Content & Discovery → Audiobook download sources → RSS feeds**). Tap **TorBox** on a post: 128bit takes the magnet from the feed item, or reads the info hash and trackers from the post's page, builds the magnet and sends it to TorBox.

### Getting a book (Pageturner style)

1. **Audiobooks tab → search bar**: search Audible's catalog by **Title / Author / Narrator / All** (recent searches are kept). Results show cover, narrators, rating, length and series.
2. Tap a book → **Book Details** → **Download**: it goes on your **Wanted** list (and Hardcover **Want to Read**), the best release is found on AudiobookBay / your download sources (series number aware, so Book 1 doesn't grab Book 7) and sent to TorBox. **Choose a release myself** lists them all instead.
3. **Wanted** shows each book's TorBox progress. In the book: **Download when ready** saves it to the phone as soon as TorBox finishes (checked every minute while the app is open); once ready: **Play** or **Download to phone** (it also lands in your Library).

### AudiobookBay search and the Wanted list

Searching in **Find audiobooks** also searches AudiobookBay's whole catalog (the same way [audiobookbay-automated](https://github.com/JamesRy96/audiobookbay-automated) does), with **Load more**. Tapping a book from iTunes/Audible shows AudiobookBay matches too, plus **Add to Wanted**.

**Audiobooks → Wanted** keeps books you want but don't have yet. Each one is checked against AudiobookBay and your download sources; when a match turns up, tap **TorBox** on it. With Hardcover connected, Wanted syncs with your **Want to Read** shelf both ways (new Want to Read books come in; books you add here go there).

### Comics from Mihon extensions (Keiyoushi) via Suwayomi

Mihon/Tachiyomi extensions are Android plug-ins only Mihon-style apps can run, so 128bit uses [Suwayomi](https://github.com/Suwayomi/Suwayomi-Server), which runs them on a computer, NAS or ElfHosted.

1. Run Suwayomi and note its address (e.g. `http://192.168.1.20:4567`).
2. **Settings → Comics → Suwayomi server**: address (+ username/password if set) → **Connect**.
3. **Add Keiyoushi repo** (`https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json`) or any other repo URL. A GitHub repo page (e.g. `github.com/keiyoushi/extensions`) or a bare base address works too: it's turned into the repo's index the way TachiyomiJ2K does (index.min.json → repo.json → `index_v2` protobuf store).
4. **Update repos** fetches the newest extension list from GitHub; install, update (**Update all**) or remove extensions.
5. The **Comics** tab gets a source switcher: MangaDex plus every source from your extensions (popular, latest, search). Read progress syncs back to Suwayomi.

### Comics on the phone (no server)

- On a comic: **Download unread chapters to phone**, or hold a chapter → Download / Delete; downloaded chapters read offline.
- Comics tab → **Import CBZ files from this phone**: pick one or more `.cbz`/`.zip` files; they become one series (each file a chapter/volume) under **On this phone**.
- **Settings → Downloads → Comics** lists and deletes them.

Mihon extensions themselves only run inside Mihon-style apps, so for those sources Suwayomi is still needed.

### Comics like audiobooks: GetComics and The Pirate Bay

Comics tab → **Find**: one search covers GetComics and The Pirate Bay's Comics category. **CBZ and CBR both open** in the Android app (CBR = RAR4 and RAR5, also CB7/CBT), unpacked by the app's own native module (`app/modules/comic-archive`, libarchive) straight to files, so even 500 MB volumes don't need to fit in memory. The downloaded archive is deleted once unpacked. PDF comics aren't supported.

- **Get**: GetComics comics download straight to the phone (through the post's **PixelDrain** mirror, which serves files to apps; "Download Now" is tried next; MEGA/TeraBox-type mirrors are web pages and are never used); Pirate Bay torrents go to **TorBox** and, when ready, the CBZ files inside are downloaded (a pack becomes one series, each file a chapter). The comic lands under **On this phone** with its cover (GetComics cover art, or the closest GetComics match for torrents).
- **Wanted** shows each comic's progress: a pixel bar with **"123 MB of 565 MB · 4.2 MB/s"** and what it's doing (Finding the file / TorBox is downloading it / Downloading / Unpacking). Downloads run in the background (leave the page, background the app, screen off) and the **Comics tab shows a badge** with how many are coming. **✕** cancels: stops the download, deletes the partial file and takes it off the list (big ones ask first, and torrents can also be deleted from TorBox). Retry on failure. TorBox is checked every minute while the app is open.
- **Follow** a series: GetComics and TPB are checked every 6 hours for issues after the one you have; they show under **New issues** (Get or dismiss), or turn on **Get new issues automatically**.
- If a site moves, change its address in **Settings → Comics → Find comics**.
- **Saving space**: **Settings → Downloads → Comics → Delete read chapters** removes every chapter you've finished (shows how much space is used), and **Settings → Comics → Delete chapters after reading** does it automatically (a chapter leaves the phone when you finish the next one). Import from the phone also takes CBR files.

### Manga: Weeb Central (Jujutsu Kaisen, Solo Leveling…)

MangaDex has taken down most big licensed series. Comics tab → **Find → Manga** searches **Weeb Central**, a full manga/manhwa catalogue (Jujutsu Kaisen, Solo Leveling, One Piece, Blue Lock…), built in like a Mihon extension, no server needed. With no search it shows Popular and Latest updates. Read online in the same reader (resume, Next chapter), or download chapters to the phone from the comic's page. Series you read show in **Library → Reading online**.

### WEBTOON (read online)

Comics tab → **Find → WEBTOON**: search webtoons.com (Originals and Canvas, e.g. *Dungeon Crawler Carl*), open a series, tap an episode. Episodes stream to the phone (nothing is downloaded) in the scrolling reader, with a **Next** button at the end of each. Series you read show in **Library → Reading online**.

### Picking up where you left off (comics)

The reader remembers the exact page **and how far down it** you scrolled. Tapping a comic in **Library** goes straight back into the reader at that spot (if you'd finished the chapter, the next one opens); hold it for the comic's page.

### Listening with the screen off

Audiobooks keep playing with the screen off, with the app in the background **and after you swipe the app away**: the player runs outside the app's screens and the lock-screen/notification controls keep it alive. The Now Playing screen frames the cover, title and author in a blocky pixel border in your accent colour, with an equalizer that bounces while the book plays. The lock screen shows the book cover (or the 128bitPlay pixel art), title, author and **current chapter** ("Ch. 3 of 12"), with play/pause, back/forward 30 s and previous/next chapter. Videos still need the screen on.

(The chapter buttons and 30 s skips are a small patch to expo-audio in `app/patches/`, applied by the build; `package.json` builds expo-audio and expo-video from source so the patches are used.)

### Video: audio that always plays, and getting back

The video player decodes audio with **FFmpeg** first (Jellyfin's media3 FFmpeg decoder, patched into expo-video in `app/patches/`), so Dolby Digital Plus (EAC3), AC3, DTS and TrueHD tracks play even on phones whose own decoder is missing or fails (e.g. `c2.dolby.eac3.decoder` errors). The Android back button / back swipe leaves the player, and a failed stream offers **Back to pick another stream**.

### Continue watching, skip intro, loading poster

- **Continue watching** remembers the stream you were watching: one tap starts it again from your spot (TorBox links are fetched fresh). If it hasn't started within 30 s or fails, the stream picker opens instead.
- **Skip intro**: anime openings come from **AniSkip**, show intros and recaps from **IntroDB**; a **SKIP INTRO** button shows during them (or turn on **Settings → Playback → Skip intros automatically**). Episodes nobody has marked get a **+85s** button for the first 5 minutes.
- While a stream loads, the show's art, title and episode show until the picture actually starts.

### English first (every video)

**Settings → Playback → English first** (on by default): every video (anime, shows, movies) switches to an **English audio track** (dub) when the video has one and **always turns on English subtitles** when there are any (the video's own track, otherwise an English one from your subtitle addons). Streams that look like English dubs ("Dual Audio", "English Dub", 🇬🇧) are listed first and badged **EN dub**.

### App updates

**Settings → About → Check for updates** compares your build with the newest GitHub release and opens the APK download. The repo is private, so the first check asks for a read-only fine-grained GitHub token (only this repo, Contents: Read-only).

### Optional: TMDB and MDBList

**Settings → Integrations → Metadata & ratings**:

- **TMDB** (free key at themoviedb.org/settings/api): title pages get cast with photos, the trailer, age rating, runtime, seasons, network and **More like this**.
- **MDBList** (free key at mdblist.com/preferences): ratings from IMDb, Rotten Tomatoes, audience score, Metacritic, Letterboxd, Trakt, TMDB and MAL; pick which ones to show.

### Optional: Simkl

1. On simkl.com: **Settings → Developer → Create new app**, type **TV, devices & command line** (new "AUTH V2" apps). Older apps with redirect URI `urn:ietf:wg:oauth:2.0:oob` work too.
2. In the app: **Settings → Tracking → Simkl**, paste the **Client ID**, tap **Connect Simkl**; simkl.com opens with the code filled in, approve it. New-style sign-ins are refreshed automatically.

Movies, episodes and anime (IMDb and Kitsu ids) are scrobbled to Simkl, next to Trakt if you use both.

### Optional: Hardcover

**Settings → Tracking → Hardcover**: paste your token from <https://hardcover.app/account/api>. Books you listen to are marked Currently Reading with your progress (every few minutes and whenever you pause), and Read when you finish. **Each time the app opens**, progress syncs both ways: if Hardcover is further along (you listened elsewhere) your place here moves up, and if this phone is further along Hardcover is updated. **Sync now** does it on demand. Tap **Hardcover** in the player to fix a wrong match or stop tracking a book. Progress is sent against the book's **audiobook edition** (the one closest to your audiobook's length), so Hardcover shows the % complete.

### Audiobook sources (Pageturner format)

Two kinds, both added in **Settings → Content & Discovery → Audiobook download sources**:

- **Book catalogs** (iTunes, Audible…) fill **Find audiobooks** with Bestsellers, New Releases and genre rows, plus search results. Tap a book to look for it in your download sources.
- **Download sources** (torrent indexes): paste a source URL from <https://pageturner-dsc.elfhosted.com/> (pick a source, tap Copy). Torrent sources are searched when you search in Audiobooks; tap **TorBox** on a result to add it to your TorBox account, then play or download it from **Your TorBox cloud**. Direct-download (HLS) sources aren't supported yet, and some sources only answer the Pageturner app itself.

### Android TV app ("128bitPlay TV")

Every build also makes `128bit-tv-<version>-build<N>.apk`: the same app for Android TV with **Shows, Movies, Anime and Live TV** only (no Books or Comics). It has its own name and package (`app.bit128.mtab.tv`), so it installs next to the phone app, and it shows in the TV's launcher with a banner. Everything works with the remote: the focused item gets a ring in your accent colour. Live TV has big channel rows and **CH ▲ / CH ▼** buttons in the player to flip through the list you opened. Sideload it with e.g. *Downloader* or *Send Files to TV*. (The phone APK also switches to this layout if it's installed on a TV.)

### Account & sync (your own Supabase project)

**Settings → Account & sync** signs you in on every phone and TV so your setup follows you: add-ons (in order), settings, Live TV playlists, TorBox / TMDB / MDBList keys, Trakt and Simkl sign-ins, Continue watching, and on phones also books (library, positions, wanted) and comics (library, progress, follows). Changes are sent a few seconds after you make them and fetched each time the app opens; **Sync now** does both. The TV only takes the video parts and leaves books/comics in the account untouched.

Setup, once (free):

1. Create a project at [supabase.com](https://supabase.com) → **New project**.
2. **SQL Editor** → paste the setup SQL (**Settings → Account & sync → Copy setup SQL** in the app, or `SETUP_SQL` in `app/src/lib/account.ts`) → **Run**.
3. **Authentication → Sign In / Providers**: turn on **Anonymous sign-ins** (that's how TVs pair). Optionally turn off **Confirm email** so new accounts work straight away.
4. **Settings → API**: copy the **Project URL** and the **anon public** key into the app (once per device), or add them as repo secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY` so every build has them built in.
5. On the phone: **Create account** (email + password). On the TV: Settings → Account & sync shows a code and a QR code; scan the QR with the phone (or enter the code under **Sign in a TV**) and the TV fills in.

Your settings and keys are stored in your own project; the tables can only be reached through the setup functions, each account sees only its own row, and a paired TV sees only its owner's.

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
