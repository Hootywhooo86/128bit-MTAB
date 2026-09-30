# 128bit audiobook addon protocol

An addon is any web server (or static file host) that serves a few JSON files. The app installs an addon from its **manifest URL** and builds every other URL from that base, the same way Stremio does.

If the manifest is at `https://example.com/my-addon/manifest.json`, the base URL is `https://example.com/my-addon`.

All responses are JSON. Servers should send `Access-Control-Allow-Origin: *` so the web build works too.

## 1. Manifest: `GET {base}/manifest.json`

```json
{
  "id": "com.example.audiobooks",
  "name": "Example Audiobooks",
  "version": "1.0.0",
  "description": "Short description shown in the Addons tab",
  "logo": "https://example.com/logo.png",
  "types": ["audiobook"],
  "resources": ["catalog", "book"],
  "catalogs": [
    { "type": "audiobook", "id": "popular", "name": "Popular", "extra": [{ "name": "search" }] },
    { "type": "audiobook", "id": "new", "name": "New releases" }
  ]
}
```

- `types` must include `"audiobook"` or the app will refuse to install it.
- A catalog with `extra: [{ "name": "search" }]` is used when the user searches.

## 2. Catalog: `GET {base}/catalog/audiobook/{catalogId}.json`

Search: `GET {base}/catalog/audiobook/{catalogId}/search={urlencoded query}.json`

```json
{
  "books": [
    {
      "id": "adventures_holmes",
      "title": "The Adventures of Sherlock Holmes",
      "author": "Arthur Conan Doyle",
      "narrator": "optional",
      "cover": "https://…/cover.jpg",
      "duration": "10:17:59"
    }
  ]
}
```

## 3. Book: `GET {base}/book/audiobook/{id}.json`

```json
{
  "book": {
    "id": "adventures_holmes",
    "title": "The Adventures of Sherlock Holmes",
    "author": "Arthur Conan Doyle",
    "cover": "https://…/cover.jpg",
    "description": "…",
    "sources": [ /* see below */ ]
  }
}
```

### Sources

Each source is one way to get the book. The user picks one, and the app handles it based on which field is set:

| Field | What the app does |
|---|---|
| `chapters: [{ "title", "url" }]` | Streams the URLs directly, in order. No TorBox needed. |
| `infoHash` or `magnet` | Adds the torrent to the user's **TorBox** account. When TorBox has it, every audio file becomes a chapter (natural sort order). |
| `webUrl` | Sends the link to **TorBox web downloads** (hosters, direct files, and so on), then plays it the same way. |

Optional fields on any source: `name` (a short label), `title` (a second line of detail), `size` (bytes).

```json
{ "name": "Direct", "chapters": [{ "title": "Chapter 1", "url": "https://…/01.mp3" }] }
{ "name": "Torrent → TorBox", "infoHash": "52f7fecc124d841a5c8ea9671a2337ee7c7204d3", "size": 3651879800 }
{ "name": "Hoster → TorBox", "webUrl": "https://some-host.example/file/abc" }
```

## Static hosting

Every path ends in `.json`, so an addon without search can be plain files on GitHub Pages, Netlify or similar:

```
manifest.json
catalog/audiobook/popular.json
book/audiobook/adventures_holmes.json
```
