import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
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
  comicImage,
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
import { Pressable } from '@/components/focusable';

const MODES = ['vertical', 'rtl', 'ltr'] as const;

/** Load the next pages early. (Suwayomi pages need sign-in headers, so they load on demand.) */
function prefetch(urls: string[]) {
  const plain = urls.filter((u) => !comicImage(u)?.headers);
  if (plain.length) Image.prefetch(plain);
}
// FlatList doesn't allow these to change between renders, so they're fixed objects.
const PAGED_VIEW = { itemVisiblePercentThreshold: 60 };
const SCROLL_VIEW = { itemVisiblePercentThreshold: 30 };
const MODE_LABEL = { vertical: 'Scroll', rtl: 'Pages ←', ltr: 'Pages →' };
const DEFAULT_RATIO = 1.45;
/** Page shapes per chapter, so the scroll reader can land exactly where you stopped. */
const RATIOS_KEY = (chapterId: string) => `128bit.comics.ratios.${chapterId}`;

/** Full-screen comic reader. Tap to show or hide the controls. */
export default function ReaderScreen() {
  useKeepAwake();
  const Colors = useColors();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { prefs, setPref } = usePrefs();
  const params = useLocalSearchParams<{ id: string; chapter: string; resume?: string }>();
  // WEBTOON episodes are one long strip: always the scroll reader.
  const webtoon = params.id.startsWith('wt:');
  const mode = webtoon ? 'vertical' : prefs.readerMode;

  const [comic, setComic] = useState<Comic | null>(null);
  const [chapters, setChapters] = useState<ComicChapter[]>(knownChapters(params.id) ?? []);
  const [chapterId, setChapterId] = useState(params.chapter);
  const [pages, setPages] = useState<string[] | null>(null);
  const [ratios, setRatios] = useState<Record<number, number>>({});
  const [page, setPage] = useState(0);
  const [startPage, setStartPage] = useState<number | null>(null);
  const startOffset = useRef(0);
  const startRatio = useRef(DEFAULT_RATIO);
  /** Where you are in the scroll reader: page + how far down it (0..1). */
  const pos = useRef({ page: 0, offset: 0 });
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
        const here = saved?.chapterId === chapterId && saved.page < urls.length;
        const at = here ? saved!.page : 0;
        startOffset.current = here ? (saved!.offset ?? 0) : 0;
        pos.current = { page: at, offset: startOffset.current };
        startRatio.current = DEFAULT_RATIO;
        try {
          const known = JSON.parse((await AsyncStorage.getItem(RATIOS_KEY(chapterId))) ?? '{}');
          startRatio.current = known[at] ?? DEFAULT_RATIO;
          if (!cancelled) setRatios(known);
        } catch {
          // Shapes come in as the pages load.
        }
        if (cancelled) return;
        setPages(urls);
        setPage(at);
        setStartPage(at);
        prefetch(urls.slice(at, at + 4));
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
      if (startPage > 0 || startOffset.current > 0) {
        // Scroll reader: also how far down the page you were.
        const h = mode === 'vertical' ? width * startRatio.current : 0;
        list.current?.scrollToIndex({
          index: startPage,
          animated: false,
          viewOffset: -startOffset.current * h,
        });
      }
      setStartPage(null);
    }, 80);
    return () => clearTimeout(t);
  }, [startPage, pages, mode, width]);

  // Save the page; the last page marks the chapter read.
  useEffect(() => {
    if (!comic || !chapter || !pages) return;
    const last = page >= pages.length - 1;
    saveComicProgress(comic, chapter, page, pages.length, last, pos.current.page === page ? pos.current.offset : 0);
    if (last && finishedFor.current !== chapter.id) {
      finishedFor.current = chapter.id;
      addChapterRead(comic);
    }
    prefetch(pages.slice(page + 1, page + 4));
  }, [comic, chapter, page, pages]);

  // Keep the page shapes, for an exact resume next time.
  useEffect(() => {
    if (pages && Object.keys(ratios).length) {
      AsyncStorage.setItem(RATIOS_KEY(chapterId), JSON.stringify(ratios)).catch(() => {});
    }
  }, [ratios, pages, chapterId]);

  // Where each page starts in the scroll reader (from the page shapes).
  const tops = useMemo(() => {
    const t: number[] = [];
    let y = 0;
    for (let i = 0; i < (pages?.length ?? 0); i++) {
      t.push(y);
      y += width * (ratios[i] ?? DEFAULT_RATIO);
    }
    return t;
  }, [pages, ratios, width]);

  // Scroll reader: remember the exact spot, saved when you stop scrolling.
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (mode !== 'vertical' || !tops.length) return;
      const y = e.nativeEvent.contentOffset.y;
      let i = 0;
      while (i + 1 < tops.length && tops[i + 1] <= y) i++;
      const h = width * (ratios[i] ?? DEFAULT_RATIO);
      pos.current = { page: i, offset: h ? Math.min(1, Math.max(0, (y - tops[i]) / h)) : 0 };
    },
    [mode, tops, ratios, width],
  );
  const saveSpot = useCallback(() => {
    if (!comic || !chapter || !pages) return;
    const { page: p, offset } = pos.current;
    saveComicProgress(comic, chapter, p, pages.length, p >= pages.length - 1, offset);
  }, [comic, chapter, pages]);

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

  // Opened with "resume": if that chapter was finished, carry on with the next one.
  const resumed = useRef(params.resume !== '1');
  useEffect(() => {
    if (resumed.current || !chapters.length) return;
    resumed.current = true;
    getComicProgress(params.id).then((saved) => {
      const i = chapters.findIndex((c) => c.id === params.chapter);
      const done =
        saved?.chapterId === params.chapter &&
        (saved.read.includes(params.chapter) || saved.page >= saved.pages - 1);
      if (done && i >= 0 && i + 1 < chapters.length) goTo(chapters[i + 1]);
    }, () => {});
  }, [chapters, params.id, params.chapter, goTo]);

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
          getItemLayout={(_, i) =>
            paged
              ? { length: width, offset: width * i, index: i }
              : { length: width * (ratios[i] ?? DEFAULT_RATIO), offset: tops[i] ?? 0, index: i }
          }
          onScroll={onScroll}
          scrollEventThrottle={200}
          onMomentumScrollEnd={saveSpot}
          onScrollEndDrag={saveSpot}
          onScrollToIndexFailed={({ index: i }) =>
            setTimeout(() => list.current?.scrollToIndex({ index: i, animated: false }), 200)
          }
          renderItem={({ item, index: i }) => (
            <Pressable onPress={toggle}>
              <Image
                source={comicImage(item)}
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
            {webtoon ? null : (
              <Pressable onPress={cycleMode} style={styles.modeButton} accessibilityLabel="Reading mode">
                <Text style={styles.modeText}>{MODE_LABEL[mode]}</Text>
              </Pressable>
            )}
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
