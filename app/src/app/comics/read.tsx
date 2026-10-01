import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
  useWindowDimensions,
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { knownChapters, rememberChapters } from '@/lib/comic-session';
import {
  chapterLabel,
  getChapters,
  getComic,
  getComicProgress,
  getPages,
  saveComicProgress,
  type Comic,
  type ComicChapter,
} from '@/lib/comics';
import { usePrefs } from '@/lib/prefs';
import { addChapterRead } from '@/lib/stats';

const MODES = ['vertical', 'rtl', 'ltr'] as const;
// FlatList doesn't allow these to change between renders, so they're fixed objects.
const PAGED_VIEW = { itemVisiblePercentThreshold: 60 };
const SCROLL_VIEW = { itemVisiblePercentThreshold: 30 };
const MODE_LABEL = { vertical: 'Scroll', rtl: 'Pages ←', ltr: 'Pages →' };

/** Full-screen comic reader. Tap to show or hide the controls. */
export default function ReaderScreen() {
  useKeepAwake();
  const Colors = useColors();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { prefs, setPref } = usePrefs();
  const mode = prefs.readerMode;
  const params = useLocalSearchParams<{ id: string; chapter: string }>();

  const [comic, setComic] = useState<Comic | null>(null);
  const [chapters, setChapters] = useState<ComicChapter[]>(knownChapters(params.id) ?? []);
  const [chapterId, setChapterId] = useState(params.chapter);
  const [pages, setPages] = useState<string[] | null>(null);
  const [ratios, setRatios] = useState<Record<number, number>>({});
  const [page, setPage] = useState(0);
  const [startPage, setStartPage] = useState<number | null>(null);
  const [controls, setControls] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<FlatList<string>>(null);
  const finishedFor = useRef<string | null>(null);

  const index = chapters.findIndex((c) => c.id === chapterId);
  const chapter = chapters[index];
  const prev = index > 0 ? chapters[index - 1] : undefined;
  const next = index >= 0 && index + 1 < chapters.length ? chapters[index + 1] : undefined;

  useEffect(() => {
    getComic(params.id).then(setComic, () => {});
    if (!knownChapters(params.id)) {
      getChapters(params.id).then((c) => {
        rememberChapters(params.id, c);
        setChapters(c);
      }, (e) => setError(e.message));
    }
  }, [params.id]);

  // Load this chapter's pages, and where you stopped in it last time.
  useEffect(() => {
    let cancelled = false;
    getPages(chapterId, prefs.comicDataSaver).then(
      async (urls) => {
        if (cancelled) return;
        const saved = await getComicProgress(params.id);
        const at = saved?.chapterId === chapterId && saved.page < urls.length - 1 ? saved.page : 0;
        setPages(urls);
        setPage(at);
        setStartPage(at);
        Image.prefetch(urls.slice(at, at + 4));
      },
      (e) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [chapterId, params.id, prefs.comicDataSaver]);

  // Jump to the saved page once the list exists.
  useEffect(() => {
    if (startPage === null || !pages) return;
    const t = setTimeout(() => {
      if (startPage > 0) list.current?.scrollToIndex({ index: startPage, animated: false });
      setStartPage(null);
    }, 50);
    return () => clearTimeout(t);
  }, [startPage, pages]);

  // Save the page; the last page marks the chapter read.
  useEffect(() => {
    if (!comic || !chapter || !pages) return;
    const last = page >= pages.length - 1;
    saveComicProgress(comic, chapter, page, pages.length, last);
    if (last && finishedFor.current !== chapter.id) {
      finishedFor.current = chapter.id;
      addChapterRead(comic);
    }
    Image.prefetch(pages.slice(page + 1, page + 4));
  }, [comic, chapter, page, pages]);

  // FlatList needs the same function every render.
  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const visible = viewableItems.map((v) => v.index ?? 0);
    if (visible.length) setPage(Math.max(...visible));
  }, []);

  const goTo = useCallback((c?: ComicChapter) => {
    if (!c) return;
    setPages(null);
    setRatios({});
    setPage(0);
    setChapterId(c.id);
  }, []);

  const cycleMode = () => setPref('readerMode', MODES[(MODES.indexOf(mode) + 1) % MODES.length]);

  const paged = mode !== 'vertical';
  const toggle = () => setControls((v) => !v);

  return (
    <View style={styles.screen}>
      <StatusBar hidden={!controls} style="light" />
      {error ? (
        <View style={styles.center}>
          <Text style={{ color: Colors.danger, textAlign: 'center' }}>{error}</Text>
        </View>
      ) : !pages ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <FlatList
          key={`${chapterId}:${mode}`}
          ref={list}
          data={pages}
          keyExtractor={(u) => u}
          horizontal={paged}
          pagingEnabled={paged}
          inverted={mode === 'rtl'}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={paged ? PAGED_VIEW : SCROLL_VIEW}
          initialNumToRender={3}
          windowSize={7}
          getItemLayout={
            paged ? (_, i) => ({ length: width, offset: width * i, index: i }) : undefined
          }
          onScrollToIndexFailed={({ index: i }) =>
            setTimeout(() => list.current?.scrollToIndex({ index: i, animated: false }), 200)
          }
          renderItem={({ item, index: i }) => (
            <Pressable onPress={toggle}>
              <Image
                source={{ uri: item }}
                style={
                  paged
                    ? { width, height }
                    : { width, height: width * (ratios[i] ?? 1.45) }
                }
                contentFit={paged ? 'contain' : 'cover'}
                recyclingKey={item}
                onLoad={(e) => {
                  const r = e.source.height / e.source.width;
                  if (r && Math.abs(r - (ratios[i] ?? 0)) > 0.01) setRatios((x) => ({ ...x, [i]: r }));
                }}
              />
            </Pressable>
          )}
          ListFooterComponent={
            paged ? null : (
              <View style={styles.footer}>
                <Text style={styles.footerText}>End of {chapter ? chapterLabel(chapter) : 'chapter'}</Text>
                {next ? (
                  <Pressable style={styles.nextButton} onPress={() => goTo(next)}>
                    <Text style={styles.nextText}>Next: {chapterLabel(next)}</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.footerText}>You’re caught up.</Text>
                )}
              </View>
            )
          }
        />
      )}

      {controls ? (
        <>
          <View style={[styles.bar, { paddingTop: insets.top + Spacing.two, top: 0 }]}>
            <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Close reader">
              <Ionicons name="chevron-back" size={26} color="#fff" />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.barTitle} numberOfLines={1}>
                {comic?.title ?? ''}
              </Text>
              <Text style={styles.barSub} numberOfLines={1}>
                {chapter ? chapterLabel(chapter) : ''}
              </Text>
            </View>
            <Pressable onPress={cycleMode} style={styles.modeButton} accessibilityLabel="Reading mode">
              <Text style={styles.modeText}>{MODE_LABEL[mode]}</Text>
            </Pressable>
          </View>
          <View style={[styles.bar, styles.bottom, { paddingBottom: insets.bottom + Spacing.two }]}>
            <Pressable
              onPress={() => goTo(prev)}
              disabled={!prev}
              hitSlop={10}
              style={{ opacity: prev ? 1 : 0.3 }}
              accessibilityLabel="Previous chapter">
              <Ionicons name="play-skip-back" size={24} color="#fff" />
            </Pressable>
            <Text style={styles.pageText}>
              {pages ? `${Math.min(page + 1, pages.length)} / ${pages.length}` : ''}
            </Text>
            <Pressable
              onPress={() => goTo(next)}
              disabled={!next}
              hitSlop={10}
              style={{ opacity: next ? 1 : 0.3 }}
              accessibilityLabel="Next chapter">
              <Ionicons name="play-skip-forward" size={24} color="#fff" />
            </Pressable>
          </View>
        </>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  screen: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    backgroundColor: 'rgba(0,0,0,0.78)',
  },
  bottom: { bottom: 0, justifyContent: 'space-between' },
  barTitle: { color: '#fff', fontWeight: '800', fontSize: 16 },
  barSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  modeButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: Radius.lg,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  modeText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  pageText: { color: '#fff', fontWeight: '700', fontVariant: ['tabular-nums'] },
  footer: { padding: Spacing.five, gap: Spacing.three, alignItems: 'center' },
  footerText: { color: 'rgba(255,255,255,0.7)' },
  nextButton: {
    backgroundColor: Colors.accent,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Radius.lg,
  },
  nextText: { color: Colors.accentText, fontWeight: '800' },
}));
