import * as torbox from './torbox';
import type { BookDetail, Chapter, PlayableBook, Source } from './types';

export type ResolveResult =
  | { status: 'ready'; book: PlayableBook }
  | { status: 'downloading'; kind: torbox.TorboxItem['kind']; itemId: number; progress: number };

type Meta = { title?: string; author?: string; cover?: string };

export function torboxBookKey(kind: torbox.TorboxItem['kind'], id: number) {
  return `torbox:${kind}:${id}`;
}

/** Turns a finished TorBox item into a playable book (one chapter per audio file). */
export function bookFromTorboxItem(item: torbox.TorboxItem, meta: Meta = {}): PlayableBook {
  const files = torbox.sortFiles(item.files.filter(torbox.isAudioFile));
  const chapters: Chapter[] = files.map((f) => ({
    id: `${item.id}:${f.id}`,
    title: (f.short_name ?? f.name.split('/').pop() ?? f.name).replace(torbox.AUDIO_EXT, ''),
    size: f.size,
    ext: f.name.match(torbox.AUDIO_EXT)?.[1]?.toLowerCase(),
    ref: { type: 'torbox', kind: item.kind, itemId: item.id, fileId: f.id },
  }));
  return {
    key: torboxBookKey(item.kind, item.id),
    title: meta.title ?? item.name,
    author: meta.author,
    cover: meta.cover,
    chapters,
  };
}

/** Takes a source picked from an addon and gets it ready to play, sending it to TorBox if needed. */
export async function resolveSource(
  addonId: string,
  book: BookDetail,
  source: Source,
): Promise<ResolveResult> {
  const meta = { title: book.title, author: book.author, cover: book.cover };

  if (source.chapters?.length) {
    return {
      status: 'ready',
      book: {
        key: `${addonId}:${book.id}`,
        title: book.title,
        author: book.author,
        cover: book.cover,
        chapters: source.chapters.map((c, i) => ({
          id: String(i),
          title: c.title,
          ref: { type: 'url', url: c.url },
        })),
      },
    };
  }

  let kind: torbox.TorboxItem['kind'];
  let itemId: number;
  if (source.infoHash || source.magnet) {
    kind = 'torrent';
    const magnet = source.magnet ?? torbox.magnetFromHash(source.infoHash!, book.title);
    itemId = (await torbox.addMagnet(magnet, book.title)).id;
  } else if (source.webUrl) {
    kind = 'webdl';
    itemId = (await torbox.addWebDownload(source.webUrl, book.title)).id;
  } else {
    throw new Error('This source has nothing playable in it');
  }

  return checkTorbox(kind, itemId, meta);
}

/** Polls a TorBox item once; ready when TorBox has finished downloading it. */
export async function checkTorbox(
  kind: torbox.TorboxItem['kind'],
  itemId: number,
  meta: Meta = {},
): Promise<ResolveResult> {
  const item = await torbox.getItem(kind, itemId);
  if (!item.download_finished) {
    return { status: 'downloading', kind, itemId, progress: item.progress };
  }
  const playable = bookFromTorboxItem(item, meta);
  if (!playable.chapters.length) throw new Error('TorBox finished, but there are no audio files in it');
  return { status: 'ready', book: playable };
}
