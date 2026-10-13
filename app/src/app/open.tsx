/**
 * bit128://open — 128bit Tracker's ▶ PLAY / RESUME / LISTEN / READ buttons land here
 * and this sends you to the right place:
 *   kind=movie   id=tt…                         → pick a stream for the movie
 *   kind=episode id=tt… | kitsu:… season episode → pick a stream for that episode
 *   kind=show    id=…                           → the show's page
 *   kind=book    key=<Play book key>             → plays it (else the Audiobooks tab)
 *   kind=comic   key=<Play comic id>             → the comic (else the Comics tab)
 * Without an id, movies and shows are looked up by title (Cinemeta, no key).
 */
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { EmptyState } from '@/components/ui';
import { useColors } from '@/constants/theme';
import { usePlayer } from '@/lib/player';
import { getLibrary } from '@/lib/storage';
import { getDownloadedBooks } from '@/lib/downloads';

type Params = { kind?: string; id?: string; title?: string; poster?: string; season?: string; episode?: string; key?: string };

async function findImdb(title: string, type: 'movie' | 'series') {
  const res = await fetch(`https://v3-cinemeta.strem.io/catalog/${type}/top/search=${encodeURIComponent(title)}.json`);
  if (!res.ok) return null;
  const metas: { id: string; name: string }[] = (await res.json()).metas ?? [];
  const exact = metas.find((m) => m.name.toLowerCase() === title.toLowerCase());
  return (exact ?? metas[0])?.id ?? null;
}

export default function OpenFromTracker() {
  const Colors = useColors();
  const p = useLocalSearchParams<Params>();
  const { openBook } = usePlayer();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const title = p.title ?? '';
      if (p.kind === 'book') {
        const books = [...(await getLibrary()), ...(await getDownloadedBooks().catch(() => []))];
        const book = books.find((b) => b.key === p.key) ?? books.find((b) => b.title.toLowerCase() === title.toLowerCase());
        if (book) {
          await openBook(book);
          router.replace('/player');
        } else router.replace('/audiobooks');
        return;
      }
      if (p.kind === 'comic') {
        if (p.key) router.replace({ pathname: '/comics/[id]', params: { id: p.key } });
        else router.replace('/comics');
        return;
      }
      const movie = p.kind === 'movie';
      const id = p.id || (title ? await findImdb(title, movie ? 'movie' : 'series') : null);
      if (!id) {
        setError(`Couldn't find “${title}” here. Search for it on the ${movie ? 'Movies' : 'Shows'} tab.`);
        return;
      }
      if (movie) {
        router.replace({ pathname: '/streams', params: { type: 'movie', id, title, poster: p.poster ?? '', linkId: id } });
        return;
      }
      const ep = Number(p.episode);
      if (p.kind === 'episode' && ep > 0) {
        const season = Number(p.season) || 1;
        const epId = id.startsWith('kitsu:') ? `${id}:${ep}` : `${id}:${season}:${ep}`;
        router.replace({
          pathname: '/streams',
          params: { type: 'series', id: epId, title, subtitle: `S${season} E${ep}`, poster: p.poster ?? '', linkId: id },
        });
        return;
      }
      router.replace({ pathname: '/title', params: { type: 'series', id } });
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [p.kind, p.id, p.title, p.poster, p.season, p.episode, p.key, openBook]);

  if (error) return <EmptyState title="Open from Tracker" body={error} />;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background }}>
      <Stack.Screen options={{ title: '' }} />
      <ActivityIndicator color={Colors.accent} />
    </View>
  );
}
