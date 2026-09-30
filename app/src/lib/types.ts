/**
 * Shared types: the 128bit audiobook addon protocol (docs/ADDON_PROTOCOL.md)
 * and the Stremio addon protocol used for movies, shows and live TV.
 */

export type CatalogExtra = { name: string; options?: string[]; isRequired?: boolean };

export type CatalogDef = {
  /** "audiobook" for 128bit book addons; "movie", "series" or "tv" for Stremio-style video addons. */
  type: string;
  id: string;
  name: string;
  extra?: CatalogExtra[];
};

export type ResourceDef = string | { name: string; types?: string[]; idPrefixes?: string[] };

export type Manifest = {
  id: string;
  name: string;
  version: string;
  description?: string;
  logo?: string;
  types: string[];
  resources: ResourceDef[];
  catalogs: CatalogDef[];
  idPrefixes?: string[];
};

/** An installed addon: its manifest plus the base URL it was installed from. */
export type InstalledAddon = {
  manifest: Manifest;
  /** Manifest URL without the trailing `/manifest.json`. */
  baseUrl: string;
};

// --- Video (Stremio protocol) -----------------------------------------------

export type VideoType = 'movie' | 'series' | 'tv';

export type MetaPreview = {
  id: string;
  type: string;
  name: string;
  poster?: string;
  posterShape?: 'poster' | 'landscape' | 'square';
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  imdbRating?: string;
  genres?: string[];
};

export type Episode = {
  id: string;
  title?: string;
  name?: string;
  season?: number;
  episode?: number;
  number?: number;
  released?: string;
  thumbnail?: string;
  overview?: string;
  description?: string;
};

export type MetaDetail = MetaPreview & { videos?: Episode[]; runtime?: string };

export type Stream = {
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  infoHash?: string;
  fileIdx?: number;
  externalUrl?: string;
  behaviorHints?: {
    filename?: string;
    notWebReady?: boolean;
    proxyHeaders?: { request?: Record<string, string> };
  };
};

// --- Audiobooks -------------------------------------------------------------

export type BookPreview = {
  id: string;
  title: string;
  author?: string;
  narrator?: string;
  cover?: string;
  /** Human readable, e.g. "10:17:59". */
  duration?: string;
};

export type DirectChapter = { title: string; url: string; duration?: number };

/**
 * Where a book can be played from. Exactly one of these should be set:
 * - `chapters`: direct, playable audio URLs.
 * - `infoHash` / `magnet`: a torrent that is resolved through TorBox.
 * - `webUrl`: a hoster/web link that is resolved through TorBox web downloads.
 */
export type Source = {
  name?: string;
  title?: string;
  size?: number;
  chapters?: DirectChapter[];
  infoHash?: string;
  magnet?: string;
  webUrl?: string;
};

export type BookDetail = BookPreview & {
  description?: string;
  sources: Source[];
};

/** How the player finds the audio for one chapter. TorBox links expire, so they are resolved at play time. */
export type ChapterRef =
  | { type: 'url'; url: string }
  | { type: 'torbox'; kind: 'torrent' | 'webdl'; itemId: number; fileId: number };

export type Chapter = {
  id: string;
  title: string;
  size?: number;
  /** File extension without the dot, used when saving for offline. */
  ext?: string;
  ref: ChapterRef;
};

/** A book that is ready to be played. `key` identifies it for progress and downloads. */
export type PlayableBook = {
  key: string;
  title: string;
  author?: string;
  narrator?: string;
  /** Human readable total length from the addon, e.g. "10:17:59". */
  duration?: string;
  cover?: string;
  chapters: Chapter[];
};
