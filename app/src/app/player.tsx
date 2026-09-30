import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

import { Body, Button, Cover, EmptyState, ProgressBar, Title, formatTime } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { getBookmarks, removeBookmark, type Bookmark } from '@/lib/bookmarks';
import { usePlayer, type Sleep } from '@/lib/player';
import { usePrefs } from '@/lib/prefs';

const RATES = [0.8, 1, 1.25, 1.5, 1.75, 2];
const SLEEP_CHOICES: { label: string; value: Sleep | 'minutes'; minutes?: number }[] = [
  { label: 'Off', value: null },
  { label: '15 min', value: 'minutes', minutes: 15 },
  { label: '30 min', value: 'minutes', minutes: 30 },
  { label: '45 min', value: 'minutes', minutes: 45 },
  { label: '60 min', value: 'minutes', minutes: 60 },
  { label: 'End of chapter', value: { kind: 'chapter' } },
];

type Tab = 'chapters' | 'bookmarks';

export default function PlayerScreen() {
  const Colors = useColors();
  const styles = useStyles();
  const p = usePlayer();
  const { prefs } = usePrefs();
  const [barWidth, setBarWidth] = useState(1);
  const [tab, setTab] = useState<Tab>('chapters');
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');

  const bookKey = p.book?.key;
  const loadBookmarks = useCallback(() => {
    if (bookKey) getBookmarks(bookKey).then(setBookmarks);
  }, [bookKey]);
  useEffect(loadBookmarks, [loadBookmarks]);

  if (!p.book) return <EmptyState title="Nothing playing" body="Pick a book from Audiobooks." />;
  const book = p.book;
  const chapter = book.chapters[p.chapterIndex];
  const marks = chapter?.marks ?? [];

  // With in-file chapters, the bar shows progress through the current one.
  const segStart = p.mark?.start ?? 0;
  const segEnd = p.mark ? (marks[p.mark.index + 1]?.start ?? p.duration) : p.duration;
  const segPos = Math.max(0, p.position - segStart);
  const segLen = Math.max(0, segEnd - segStart);

  const onSeek = (e: GestureResponderEvent) => {
    if (segLen) p.seekTo(segStart + (e.nativeEvent.locationX / barWidth) * segLen);
  };

  const nextRate = RATES[(RATES.indexOf(p.rate) + 1) % RATES.length] ?? 1;
  const sleepIndex =
    p.sleep === null
      ? 0
      : p.sleep.kind === 'chapter'
        ? SLEEP_CHOICES.length - 1
        : SLEEP_CHOICES.findIndex((c) => c.minutes === (p.sleep as { minutes: number }).minutes);
  const cycleSleep = () => {
    const next = SLEEP_CHOICES[(sleepIndex + 1) % SLEEP_CHOICES.length];
    p.setSleep(
      next.value === 'minutes'
        ? { kind: 'minutes', minutes: next.minutes!, at: Date.now() + next.minutes! * 60_000 }
        : next.value,
    );
  };

  const saveBookmark = async () => {
    await p.addBookmark(note);
    setNote('');
    setNoteOpen(false);
    setTab('bookmarks');
    loadBookmarks();
  };

  const deleteBookmark = (b: Bookmark) => {
    const go = async () => setBookmarks(await removeBookmark(book.key, b.id));
    if (Platform.OS === 'web') {
      if (window.confirm('Delete this bookmark?')) go();
      return;
    }
    Alert.alert('Delete bookmark', b.note ?? b.label, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: go },
    ]);
  };

  const heading = p.mark
    ? `${p.mark.title} (${p.mark.index + 1}/${marks.length})`
    : `${chapter?.title} (${p.chapterIndex + 1}/${book.chapters.length})`;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Cover uri={book.cover} size={240} />
      <View style={{ alignItems: 'center', gap: 4 }}>
        <Title style={{ fontSize: 22, textAlign: 'center' }}>{book.title}</Title>
        {book.author ? <Body muted>{book.author}</Body> : null}
        <Body style={{ color: Colors.accent, textAlign: 'center' }}>{heading}</Body>
      </View>

      <View style={{ alignSelf: 'stretch', gap: Spacing.one }}>
        <Pressable
          onPress={onSeek}
          onLayout={(e: LayoutChangeEvent) => setBarWidth(e.nativeEvent.layout.width || 1)}
          style={{ paddingVertical: Spacing.two }}>
          <ProgressBar value={segLen ? segPos / segLen : 0} />
        </Pressable>
        <View style={styles.times}>
          <Text style={styles.time}>{formatTime(segPos)}</Text>
          <Text style={styles.time}>-{formatTime(segLen - segPos)}</Text>
        </View>
      </View>

      {p.error ? <Body style={{ color: Colors.danger }}>{p.error}</Body> : null}

      <View style={styles.controls}>
        <IconButton name="play-skip-back" label="Previous chapter" onPress={p.previous} />
        <IconButton
          name="play-back"
          caption={String(prefs.skipBack)}
          label={`Back ${prefs.skipBack} seconds`}
          onPress={() => p.seekBy(-prefs.skipBack)}
        />
        <Pressable
          style={styles.playButton}
          onPress={p.toggle}
          accessibilityLabel={p.playing ? 'Pause' : 'Play'}>
          {p.loading ? (
            <ActivityIndicator color={Colors.accentText} />
          ) : (
            <Ionicons name={p.playing ? 'pause' : 'play'} size={36} color={Colors.accentText} />
          )}
        </Pressable>
        <IconButton
          name="play-forward"
          caption={String(prefs.skipForward)}
          label={`Forward ${prefs.skipForward} seconds`}
          onPress={() => p.seekBy(prefs.skipForward)}
        />
        <IconButton
          name="play-skip-forward"
          label="Next chapter"
          disabled={!p.hasNext}
          onPress={p.next}
        />
      </View>

      <View style={styles.pills}>
        <Pressable style={styles.pill} onPress={() => p.setRate(nextRate)}>
          <Text style={styles.pillText}>{p.rate}×</Text>
        </Pressable>
        <Pressable style={styles.pill} onPress={cycleSleep} accessibilityLabel="Sleep timer">
          <Ionicons name="moon" size={14} color={p.sleep ? Colors.accent : Colors.text} />
          <Text style={styles.pillText}>{p.sleep ? SLEEP_CHOICES[sleepIndex].label : 'Sleep'}</Text>
        </Pressable>
        <Pressable
          style={styles.pill}
          onPress={() => setNoteOpen(true)}
          accessibilityLabel="Add bookmark">
          <Ionicons name="bookmark" size={14} color={Colors.text} />
          <Text style={styles.pillText}>Bookmark</Text>
        </Pressable>
      </View>

      <View style={styles.tabs}>
        {(['chapters', 'bookmarks'] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={styles.tab}>
            <Text style={[styles.tabText, tab === t && { color: Colors.text }]}>
              {t === 'chapters'
                ? 'Chapters'
                : `Bookmarks${bookmarks.length ? ` (${bookmarks.length})` : ''}`}
            </Text>
            <View style={[styles.tabLine, tab === t && { backgroundColor: Colors.accent }]} />
          </Pressable>
        ))}
      </View>

      <View style={{ alignSelf: 'stretch' }}>
        {tab === 'chapters'
          ? book.chapters.flatMap((c, i) => {
              const inFile = c.marks?.length
                ? c.marks.map((m, j) => ({
                    key: `${i}:${j}`,
                    title: m.title,
                    active: i === p.chapterIndex && p.mark?.index === j,
                    onPress: () => p.jumpTo(i, m.start),
                  }))
                : [
                    {
                      key: `${i}`,
                      title: c.title,
                      active: i === p.chapterIndex,
                      onPress: () => p.jumpTo(i, 0),
                    },
                  ];
              return inFile.map((row, n) => (
                <Pressable key={row.key} style={styles.listRow} onPress={row.onPress}>
                  <Text style={[styles.listNum, row.active && { color: Colors.accent }]}>
                    {n +
                      1 +
                      book.chapters.slice(0, i).reduce((s, x) => s + (x.marks?.length || 1), 0)}
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={[styles.listTitle, row.active && { color: Colors.accent }]}>
                    {row.title}
                  </Text>
                </Pressable>
              ));
            })
          : null}
        {tab === 'bookmarks' ? (
          bookmarks.length === 0 ? (
            <Body muted style={{ textAlign: 'center', padding: Spacing.three }}>
              Tap Bookmark to save your place, with an optional note.
            </Body>
          ) : (
            bookmarks.map((b) => (
              <Pressable
                key={b.id}
                style={styles.listRow}
                onPress={() => p.jumpTo(b.chapter, b.position)}
                onLongPress={() => deleteBookmark(b)}>
                <Ionicons name="bookmark" size={16} color={Colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.listTitle} numberOfLines={1}>
                    {b.label} · {formatTime(b.position)}
                  </Text>
                  {b.note ? <Text style={styles.note}>{b.note}</Text> : null}
                </View>
                <Pressable
                  hitSlop={10}
                  onPress={() => deleteBookmark(b)}
                  accessibilityLabel="Delete bookmark">
                  <Ionicons name="close" size={18} color={Colors.textSecondary} />
                </Pressable>
              </Pressable>
            ))
          )
        ) : null}
      </View>

      <Modal
        visible={noteOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setNoteOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Title style={{ fontSize: 20 }}>Add bookmark</Title>
            <Body muted>
              {p.mark?.title ?? chapter?.title} · {formatTime(p.position)}
            </Body>
            <TextInput
              style={styles.noteInput}
              placeholder="Note (optional)"
              placeholderTextColor={Colors.textSecondary}
              value={note}
              onChangeText={setNote}
              multiline
              autoFocus
            />
            <Button label="Save bookmark" onPress={saveBookmark} />
            <Button label="Cancel" variant="secondary" onPress={() => setNoteOpen(false)} />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function IconButton({
  name,
  caption,
  label,
  onPress,
  disabled,
}: {
  name: ComponentProps<typeof Ionicons>['name'];
  caption?: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const Colors = useColors();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityLabel={label}
      style={{ alignItems: 'center', opacity: disabled ? 0.3 : 1 }}>
      <Ionicons name={name} size={28} color={Colors.text} />
      {caption ? <Text style={styles.iconLabel}>{caption}</Text> : null}
    </Pressable>
  );
}

const useStyles = makeStyles((Colors) => ({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.four, gap: Spacing.four, alignItems: 'center' },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: Colors.textSecondary, fontSize: 12, fontVariant: ['tabular-nums'] },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
  },
  playButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconLabel: { color: Colors.textSecondary, fontSize: 10 },
  pills: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap', justifyContent: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceRaised,
  },
  pillText: { color: Colors.text, fontWeight: '700' },
  tabs: { flexDirection: 'row', alignSelf: 'stretch' },
  tab: { flex: 1, alignItems: 'center', gap: Spacing.two },
  tabText: { color: Colors.textSecondary, fontWeight: '700', fontSize: 15 },
  tabLine: { height: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: Colors.border },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderBottomWidth: 1,
    borderColor: Colors.border,
  },
  listNum: { color: Colors.textSecondary, width: 28, fontVariant: ['tabular-nums'] },
  listTitle: { color: Colors.text, flex: 1, fontSize: 15 },
  note: { color: Colors.textSecondary, fontSize: 13, marginTop: 2 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  modal: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  noteInput: {
    backgroundColor: Colors.surfaceRaised,
    color: Colors.text,
    borderRadius: Radius.md,
    padding: Spacing.three,
    minHeight: 80,
    textAlignVertical: 'top',
    fontSize: 15,
  },
}));
