/**
 * 128bit audiobook addon protocol.
 * See docs/ADDON_PROTOCOL.md at the repo root for the full spec.
 */

export type CatalogExtra = { name: 'search' };

export type CatalogDef = {
  type: 'audiobook';
  id: string;
  name: string;
  extra?: CatalogExtra[];
};

export type Manifest = {
  id: string;
  name: string;
  version: string;
  description?: string;
  logo?: string;
  types: string[];
  resources: string[];
  catalogs: CatalogDef[];
};

/** An installed addon: its manifest plus the base URL it was installed from. */
export type InstalledAddon = {
  manifest: Manifest;
  /** Manifest URL without the trailing `/manifest.json`. */
  baseUrl: string;
};

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
  cover?: string;
  chapters: Chapter[];
};
