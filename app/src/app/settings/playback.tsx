import { useEffect, useState } from 'react';
import { AppState, Linking, PermissionsAndroid, Platform } from 'react-native';

import { ChoiceRow, Group, Row, SectionTitle, SettingsPage, ToggleRow } from '@/components/settings-ui';
import { usePrefs } from '@/lib/prefs';
import { videoDownloadsSupported } from '@/lib/video-downloads';
import { askBatteryUnrestricted, batteryUnrestricted } from '@/lib/torrent-device';
import { SUBTITLE_LANGUAGES, languageName } from '@/lib/subtitles';
import { IS_TV } from '@/constants/tv';

const seconds = (values: number[]) => values.map((v) => ({ value: v, label: `${v}s` }));
const RATES = [0.8, 1, 1.1, 1.25, 1.5, 1.75, 2].map((v) => ({
  value: v,
  label: `${v}×`,
}));

export default function PlaybackSettings() {
  const { prefs, setPref } = usePrefs();

  return (
    <SettingsPage>
      {IS_TV ? null : (
        <>
          <SectionTitle>Audiobooks</SectionTitle>
          <Group>
            <ChoiceRow
              title="Skip back"
              subtitle="The rewind button in the player"
              value={prefs.skipBack}
              options={seconds([10, 15, 30, 45, 60])}
              onChange={(v) => setPref('skipBack', v)}
            />
            <ChoiceRow
              title="Skip forward"
              subtitle="The fast-forward button in the player"
              value={prefs.skipForward}
              options={seconds([10, 15, 30, 45, 60])}
              onChange={(v) => setPref('skipForward', v)}
            />
            <ChoiceRow
              title="Default speed"
              subtitle="Used when the app starts"
              value={prefs.defaultRate}
              options={RATES}
              onChange={(v) => setPref('defaultRate', v)}
            />
            <BatteryRow />
            <NotificationRow />
            <ToggleRow
              title="Auto-play next chapter"
              subtitle="Keep going when a chapter ends."
              value={prefs.autoNextChapter}
              onChange={(v) => setPref('autoNextChapter', v)}
            />
            <ToggleRow
              title="Watch my series for new books"
              subtitle="Once a day, new books in the series you have or want go on your Wanted list."
              value={prefs.watchSeries}
              onChange={(v) => setPref('watchSeries', v)}
            />
          </Group>
        </>
      )}

      <SectionTitle>Movies & shows</SectionTitle>
      <Group>
        <ToggleRow
          title="Auto-play next episode"
          subtitle="Start the next episode when one ends (a Next button also shows near the end)."
          value={prefs.autoPlayNextEpisode}
          onChange={(v) => setPref('autoPlayNextEpisode', v)}
        />
        <ToggleRow
          title="Resume where you left off"
          subtitle="Jump back to your last position when you reopen something."
          value={prefs.resumeVideos}
          onChange={(v) => setPref('resumeVideos', v)}
        />
        <ChoiceRow
          title="Biggest stream to show"
          subtitle="Streams over this size are hidden (you can still show them). Saves data and time to start."
          value={prefs.maxStreamGB}
          options={[0, 2, 4, 8, 15, 30].map((v) => ({ value: v, label: v ? `${v} GB` : 'No limit' }))}
          onChange={(v) => setPref('maxStreamGB', v)}
        />
        {videoDownloadsSupported ? (
          <ChoiceRow
            title="Keep next episodes downloaded"
            subtitle="While you watch a show, the next episodes download to this device for offline, and ones you've watched past are deleted."
            value={prefs.keepNextEpisodes}
            options={[0, 1, 2, 3, 5].map((v) => ({ value: v, label: v ? `Next ${v}` : 'Off' }))}
            onChange={(v) => setPref('keepNextEpisodes', v)}
          />
        ) : null}
        <ToggleRow
          title="TorBox cached streams first"
          subtitle="Show ⚡ streams that start instantly at the top of each addon."
          value={prefs.cachedFirst}
          onChange={(v) => setPref('cachedFirst', v)}
        />
      </Group>
      {IS_TV ? null : (
        <>
          <SectionTitle>Comics</SectionTitle>
          <Group>
            <ChoiceRow
              title="Reading mode"
              subtitle="You can also switch it while reading."
              value={prefs.readerMode}
              options={[
                { value: 'vertical', label: 'Scroll down' },
                { value: 'rtl', label: 'Pages, right to left' },
                { value: 'ltr', label: 'Pages, left to right' },
              ]}
              onChange={(v) => setPref('readerMode', v)}
            />
            <ToggleRow
              title="Data saver"
              subtitle="Smaller, compressed pages. Loads faster on mobile data."
              value={prefs.comicDataSaver}
              onChange={(v) => setPref('comicDataSaver', v)}
            />
          </Group>
        </>
      )}

      <SectionTitle>Skip intro</SectionTitle>
      <Group>
        <ToggleRow
          title="Skip intros automatically"
          subtitle="Anime openings (AniSkip) and show intros and recaps (IntroDB). Off: a Skip intro button shows instead. When an episode isn't marked, a +85 s button shows for the first 5 minutes."
          value={prefs.autoSkipIntro}
          onChange={(v) => setPref('autoSkipIntro', v)}
        />
      </Group>

      <SectionTitle>Subtitles</SectionTitle>
      <Group>
        <ToggleRow
          title="English first"
          subtitle="Every video plays the English audio track when it has one (e.g. anime dubs) and turns on English subtitles whenever there are any."
          value={prefs.englishFirst}
          onChange={(v) => setPref('englishFirst', v)}
        />
        <ChoiceRow
          title="Preferred language"
          subtitle="Listed first, and used when subtitles turn on automatically"
          value={prefs.subtitleLanguage}
          options={SUBTITLE_LANGUAGES.map((l) => ({ value: l, label: languageName(l) }))}
          onChange={(v) => setPref('subtitleLanguage', v)}
        />
        <ToggleRow
          title="Turn on subtitles automatically"
          subtitle="Uses your preferred language when an addon has it."
          value={prefs.autoSubtitles}
          onChange={(v) => setPref('autoSubtitles', v)}
        />
        <ChoiceRow
          title="Subtitle size"
          value={prefs.subtitleSize}
          options={[
            { value: 'small', label: 'Small' },
            { value: 'medium', label: 'Medium' },
            { value: 'large', label: 'Large' },
          ]}
          onChange={(v) => setPref('subtitleSize', v)}
        />
      </Group>
    </SettingsPage>
  );
}

/** Android's battery saver can pause background apps; "Unrestricted" keeps books playing. */
function BatteryRow() {
  const [ok, setOk] = useState(batteryUnrestricted);
  // Re-check when you come back from Android's dialog.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setOk(batteryUnrestricted()));
    return () => sub.remove();
  }, []);
  return (
    <Row
      icon="battery-charging-outline"
      title="Always play in the background"
      subtitle={
        ok
          ? 'On: Android can\'t pause your book to save battery.'
          : 'Off: Android may pause your book to save battery. Tap and choose Allow.'
      }
      value={ok ? 'On' : 'Turn on'}
      onPress={ok ? undefined : askBatteryUnrestricted}
    />
  );
}

const NOTIFY = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
const needsNotifyPermission = Platform.OS === 'android' && Number(Platform.Version) >= 33;

/** Player notification and lock-screen controls need notification permission on Android 13+. */
function NotificationRow() {
  const [ok, setOk] = useState(true);
  useEffect(() => {
    if (!needsNotifyPermission) return;
    const check = () => PermissionsAndroid.check(NOTIFY).then(setOk, () => {});
    check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => sub.remove();
  }, []);
  if (ok) return null;
  return (
    <Row
      icon="notifications-outline"
      title="Player notification is off"
      subtitle="Turn on notifications to get play/pause controls on the lock screen and in your notifications."
      value="Turn on"
      onPress={async () => {
        // Android stops asking after two "Don't allow"s: then open the app's settings instead.
        const r = await PermissionsAndroid.request(NOTIFY);
        if (r === PermissionsAndroid.RESULTS.GRANTED) setOk(true);
        else Linking.openSettings();
      }}
    />
  );
}
