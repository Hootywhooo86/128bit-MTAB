import type { ComicChapter } from './comics';

/** Chapter lists already loaded this session, so the reader can go next/previous fast. */
const chapters = new Map<string, ComicChapter[]>();

export const rememberChapters = (comicId: string, list: ComicChapter[]) =>
  chapters.set(comicId, list);

export const knownChapters = (comicId: string) => chapters.get(comicId);
