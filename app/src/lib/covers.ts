/**
 * Cover art for audiobooks that don't come with any (TorBox downloads, feeds,
 * some addons): looked up by title and author in Apple's book catalog, then
 * remembered on the phone.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

const KEY = (q: string) => `128bit.cover.${q}`;
const RETRY_MS = 7 * 24 * 3600_000;

/** "Andy Weir - Project Hail Mary (Unabridged) [M4B] 64kbps" → "Andy Weir Project Hail Mary". */
export function coverQuery(title: string, author?: string) {
  const clean = (s: string) =>
    s
      .replace(/\.(m4b|mp3|m4a|zip|rar|flac)$/i, '')
      .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ')
      .replace(
        /\b(unabridged|abridged|audiobook|audio ?book|m4b|mp3|aac|flac|\d+ ?k(bps)?|retail|chapterized|(19|20)\d\d)\b/gi,
        ' ',
      )
      .replace(/[._]+/g, ' ')
      .replace(/\s+-\s+|\s+/g, ' ')
      .trim();
  const t = clean(title);
  const a = author ? clean(author) : '';
  return (a && !t.toLowerCase().includes(a.toLowerCase()) ? `${t} ${a}` : t).slice(0, 120);
}

type Saved = { url: string | null; at: number };
const memory = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | undefined>>();

async function lookup(query: string): Promise<string | undefined> {
  for (const media of ['audiobook', 'ebook']) {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=${media}&limit=1`,
    );
    if (!res.ok) continue;
    const data = (await res.json()) as { results?: { artworkUrl100?: string }[] };
    const art = data.results?.[0]?.artworkUrl100;
    if (art) return art.replace(/\/\d+x\d+bb\./, '/600x600bb.');
  }
  return undefined;
}

/** A cover image URL for this book, or undefined if none was found. */
export async function findCover(title: string, author?: string): Promise<string | undefined> {
  const q = coverQuery(title, author);
  if (q.length < 2) return undefined;
  if (memory.has(q)) return memory.get(q) ?? undefined;
  const raw = await AsyncStorage.getItem(KEY(q));
  if (raw) {
    const saved = JSON.parse(raw) as Saved;
    if (saved.url || Date.now() - saved.at < RETRY_MS) {
      memory.set(q, saved.url);
      return saved.url ?? undefined;
    }
  }
  let pending = inFlight.get(q);
  if (!pending) {
    pending = lookup(q)
      .then(async (url) => {
        memory.set(q, url ?? null);
        await AsyncStorage.setItem(KEY(q), JSON.stringify({ url: url ?? null, at: Date.now() }));
        return url;
      })
      .catch(() => undefined) // offline: try again next time
      .finally(() => inFlight.delete(q));
    inFlight.set(q, pending);
  }
  return pending;
}

/** `uri` when there is one, otherwise a looked-up cover (once it's found). */
export function useCover(uri?: string, title?: string, author?: string) {
  const [found, setFound] = useState<{ q: string; url?: string } | null>(null);
  const q = !uri && title ? coverQuery(title, author) : '';
  useEffect(() => {
    if (!q || !title) return;
    let cancelled = false;
    findCover(title, author).then((url) => !cancelled && setFound({ q, url }));
    return () => {
      cancelled = true;
    };
  }, [q, title, author]);
  return uri ?? (found?.q === q ? found.url : undefined);
}
