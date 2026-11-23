/**
 * Free, legal audiobooks: LibriVox (public-domain books read by volunteers) and the
 * Internet Archive's audiobook collection, through archive.org's open search and metadata
 * APIs. No TorBox needed: every chapter is an MP3 that plays (or downloads) straight away.
 */
import type { Chapter, PlayableBook } from './types';

const COLLECTIONS = 'collection:(librivoxaudio OR audio_bookspoetry)';

export type FreeBook = {
  id: string;
  title: string;
  author?: string;
  cover: string;
  downloads: number;
  /** "LibriVox" or "Internet Archive". */
  from: string;
};

/** Words safe to put in an archive.org (Lucene) query. */
const terms = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 6)
    .join(' ');

async function getJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Internet Archive answered ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Books whose title or author fits the search, most listened first. */
export async function searchFreeBooks(query: string, author?: string): Promise<FreeBook[]> {
  const q = terms(query);
  if (!q) return [];
  const who = author ? terms(author) : '';
  const match = who ? `(title:(${q}) AND creator:(${who}))` : `(title:(${q}) OR creator:(${q}))`;
  const params = new URLSearchParams({
    q: `${match} AND ${COLLECTIONS} AND mediatype:audio`,
    rows: '24',
    output: 'json',
    'sort[]': 'downloads desc',
  });
  for (const f of ['identifier', 'title', 'creator', 'downloads', 'collection']) params.append('fl[]', f);
  type Doc = { identifier: string; title?: string; creator?: string | string[]; downloads?: number; collection?: string | string[] };
  const data = await getJson<{ response?: { docs?: Doc[] } }>(`https://archive.org/advancedsearch.php?${params}`);
  return (data.response?.docs ?? []).map((d) => {
    const collections = ([] as string[]).concat(d.collection ?? []);
    return {
      id: d.identifier,
      title: d.title ?? d.identifier,
      author: ([] as string[]).concat(d.creator ?? [])[0],
      cover: `https://archive.org/services/img/${d.identifier}`,
      downloads: d.downloads ?? 0,
      from: collections.includes('librivoxaudio') ? 'LibriVox' : 'Internet Archive',
    };
  });
}

type ArchiveFile = { name: string; format?: string; title?: string; track?: string; length?: string; size?: string };

/** The book, ready to play: its MP3 chapters in order (the best quality the item has). */
export async function freeBook(book: FreeBook): Promise<PlayableBook> {
  const data = await getJson<{ files?: ArchiveFile[]; metadata?: { title?: string; creator?: string | string[] } }>(
    `https://archive.org/metadata/${encodeURIComponent(book.id)}`,
  );
  const files = data.files ?? [];
  const mp3 = ['VBR MP3', '128Kbps MP3', '64Kbps MP3'].map((f) => files.filter((x) => x.format === f)).find((l) => l.length) ?? [];
  if (!mp3.length) throw new Error('No MP3 files in this recording.');
  const trackNo = (f: ArchiveFile) => Number(f.track?.split('/')[0]) || Number.MAX_SAFE_INTEGER;
  const ordered = [...mp3].sort((a, b) => trackNo(a) - trackNo(b) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const chapters: Chapter[] = ordered.map((f, i) => ({
    id: f.name,
    title: f.title?.trim() || `Part ${i + 1}`,
    size: f.size ? Number(f.size) : undefined,
    ext: 'mp3',
    ref: { type: 'url', url: `https://archive.org/download/${encodeURIComponent(book.id)}/${f.name.split('/').map(encodeURIComponent).join('/')}` },
  }));
  return {
    key: `archive:${book.id}`,
    title: book.title,
    author: book.author,
    cover: book.cover,
    chapters,
  };
}
