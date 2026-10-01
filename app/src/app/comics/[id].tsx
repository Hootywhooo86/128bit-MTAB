import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Body, Button, EmptyState, Title } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import {
  chapterLabel,
  comicImage,
  getChapters,
  getComic,
  getComicProgress,
  inComicLibrary,
  setChapterRead,
  toggleComicLibrary,
  type Comic,
  type ComicChapter,
  type ReadProgress,
} from '@/lib/comics';
import {
  comicDownloadsSupported,
  deleteChapter,
  deleteSeries,
  downloadChapters,
  getComicDownloads,
  onComicDownloads,
  type LocalChapter,
  type LocalSeries,
} from '@/lib/comic-downloads';
import { rememberChapters } from '@/lib/comic-session';

/** A comic: details, add to library, and its chapters. */
export default function ComicScreen() {
  const Colors = useColors();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [comic, setComic] = useState<Comic | null>(null);
  const [chapters, setChapters] = useState<ComicChapter[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [progress, setProgress] = useState<ReadProgress | undefined>();
  const [newestFirst, setNewestFirst] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getComic(id).then(
      (c) => !cancelled && setComic(c),
      (e) => !cancelled && setError(e.message),
    );
    getChapters(id).then(
      (c) => {
        if (cancelled) return;
        setChapters(c);
        rememberChapters(id, c);
      },
      (e) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Chapters saved on the phone (live, while downloads run).
  const [local, setLocal] = useState<Map<string, LocalChapter>>(new Map());
  useEffect(() => {
    const pick = (list: LocalSeries[]) =>
      setLocal(new Map((list.find((x) => x.comic.id === id)?.chapters ?? []).map((c) => [c.id, c])));
    getComicDownloads().then(pick);
    return onComicDownloads(pick);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      inComicLibrary(id).then(setSaved);
      getComicProgress(id).then(setProgress);
    }, [id]),
  );

  if (error && !comic) return <EmptyState title="Couldn’t load this comic" body={error} />;
  if (!comic) {
    return (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  const read = new Set(progress?.read ?? []);
  const isLocalComic = comic.id.startsWith('local:');
  const readable = (c: ComicChapter) => c.pages > 0 && !(c.externalUrl && !c.pages);
  const toDownload = (chapters ?? []).filter((c) => readable(c) && !read.has(c.id) && !local.has(c.id));

  /** Hold a chapter: read / unread, download / delete from the phone. */
  function chapterMenu(item: ComicChapter, done: boolean) {
    const onPhone = local.get(item.id)?.state === 'done';
    const options = [
      {
        text: done ? 'Mark unread' : 'Mark read',
        onPress: async () => {
          await setChapterRead(comic!.id, item.id, !done);
          setProgress(await getComicProgress(comic!.id));
        },
      },
      ...(isLocalComic
        ? []
        : [
            onPhone
              ? { text: 'Delete from phone', onPress: () => deleteChapter(comic!.id, item.id) }
              : { text: 'Download to phone', onPress: () => downloadChapters(comic!, [item], chapterLabel) },
          ]),
    ];
    if (Platform.OS === 'web') {
      options[0].onPress();
      return;
    }
    Alert.alert(chapterLabel(item), undefined, [...options, { text: 'Cancel', onPress: async () => {} }]);
  }
  const list = chapters ? (newestFirst ? [...chapters].reverse() : chapters) : [];
  // Continue: where you stopped, or the first chapter you haven't finished.
  const resume =
    chapters?.find((c) => c.id === progress?.chapterId && !read.has(c.id)) ??
    chapters?.find((c) => !read.has(c.id) && c.pages > 0);

  function open(c: ComicChapter) {
    if (c.externalUrl && !c.pages) {
      Linking.openURL(c.externalUrl);
      return;
    }
    router.push({ pathname: '/comics/read', params: { id: comic!.id, chapter: c.id } });
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: '' }} />
      <FlatList
        data={list}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ paddingBottom: Spacing.five }}
        ListHeaderComponent={
          <View style={{ gap: Spacing.three, padding: Spacing.three }}>
            <View style={{ flexDirection: 'row', gap: Spacing.three }}>
              <View style={styles.cover}>
                {comic.cover ? (
                  <Image source={comicImage(comic.cover)} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : null}
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Title style={{ fontSize: 22 }}>{comic.title}</Title>
                {comic.author ? <Body>{comic.author}</Body> : null}
                <Body muted style={{ fontSize: 13 }}>
                  {[comic.status && comic.status[0].toUpperCase() + comic.status.slice(1), comic.year]
                    .filter(Boolean)
                    .join(' · ')}
                </Body>
                {comic.tags?.length ? (
                  <Body muted style={{ fontSize: 12 }} numberOfLines={2}>
                    {comic.tags.slice(0, 6).join(' · ')}
                  </Body>
                ) : null}
              </View>
            </View>
            {resume ? (
              <Button
                label={
                  progress && resume.id === progress.chapterId
                    ? `Continue ${chapterLabel(resume)} (page ${progress.page + 1})`
                    : `${progress ? 'Continue' : 'Start'} ${chapterLabel(resume)}`
                }
                onPress={() => open(resume)}
              />
            ) : null}
            <Button
              label={saved ? '✓ In your library' : 'Add to library'}
              variant="secondary"
              onPress={async () => setSaved(await toggleComicLibrary(comic))}
            />
            {!isLocalComic && comicDownloadsSupported && toDownload.length ? (
              <Button
                label={`Download ${toDownload.length} unread chapter${toDownload.length === 1 ? '' : 's'} to phone`}
                variant="secondary"
                onPress={() => downloadChapters(comic, toDownload, chapterLabel)}
              />
            ) : null}
            {isLocalComic ? (
              <Button
                label="Delete from phone"
                variant="danger"
                onPress={async () => {
                  await deleteSeries(comic.id);
                  if (saved) await toggleComicLibrary(comic);
                  router.back();
                }}
              />
            ) : null}
            {local.size ? (
              <Text style={styles.meta}>
                Hold a chapter for read / download options · {[...local.values()].filter((c) => c.state === 'done').length} on this phone
              </Text>
            ) : (
              <Text style={styles.meta}>Hold a chapter for read / download options</Text>
            )}
            {comic.description ? (
              <Text
                style={styles.description}
                numberOfLines={expanded ? undefined : 4}
                onPress={() => setExpanded(!expanded)}>
                {comic.description}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={styles.heading}>
                {chapters ? `${chapters.length} chapters` : 'Chapters'}
              </Text>
              {chapters?.length ? (
                <Pressable onPress={() => setNewestFirst(!newestFirst)} hitSlop={8} style={styles.sort}>
                  <Ionicons name="swap-vertical" size={16} color={Colors.accent} />
                  <Text style={styles.sortText}>{newestFirst ? 'Newest first' : 'Oldest first'}</Text>
                </Pressable>
              ) : null}
            </View>
            {!chapters ? <ActivityIndicator color={Colors.accent} /> : null}
            {chapters?.length === 0 ? (
              <Body muted>
                No English chapters on MangaDex for this one (it may be officially licensed).
              </Body>
            ) : null}
          </View>
        }
        renderItem={({ item }) => {
          const done = read.has(item.id);
          const current = item.id === progress?.chapterId && !done;
          return (
            <Pressable
              style={styles.chapter}
              onPress={() => open(item)}
              onLongPress={() => chapterMenu(item, done)}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text
                  style={[styles.chapterTitle, done && { color: Colors.textSecondary }, current && { color: Colors.accent }]}
                  numberOfLines={2}>
                  {chapterLabel(item)}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {[
                    item.volume ? `Vol. ${item.volume}` : null,
                    item.group,
                    item.publishedAt ? new Date(item.publishedAt).toLocaleDateString() : null,
                    item.externalUrl && !item.pages ? 'Opens on the publisher’s site' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              {local.get(item.id)?.state === 'downloading' ? (
                <Text style={styles.meta}>{Math.round((local.get(item.id)!.progress ?? 0) * 100)}%</Text>
              ) : local.get(item.id)?.state === 'done' ? (
                <Ionicons name="phone-portrait-outline" size={18} color={Colors.accent} />
              ) : null}
              {done ? <Ionicons name="checkmark-circle" size={20} color={Colors.success} /> : null}
              {current ? <Text style={styles.meta}>p. {progress!.page + 1}</Text> : null}
              {item.externalUrl && !item.pages ? (
                <Ionicons name="open-outline" size={18} color={Colors.textSecondary} />
              ) : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  screen: { flex: 1, backgroundColor: Colors.background },
  cover: {
    width: 120,
    height: 174,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceRaised,
  },
  description: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },
  heading: { color: Colors.text, fontSize: 18, fontWeight: '800', flex: 1 },
  sort: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sortText: { color: Colors.accent, fontWeight: '700' },
  chapter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  chapterTitle: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  meta: { color: Colors.textSecondary, fontSize: 12 },
}));
