import { ChoiceRow, Group, SectionTitle, SettingsPage, ToggleRow } from '@/components/settings-ui';
import { usePrefs } from '@/lib/prefs';
import { SUBTITLE_LANGUAGES, languageName } from '@/lib/subtitles';

const seconds = (values: number[]) => values.map((v) => ({ value: v, label: `${v}s` }));
const RATES = [0.8, 1, 1.1, 1.25, 1.5, 1.75, 2].map((v) => ({
  value: v,
  label: `${v}×`,
}));

export default function PlaybackSettings() {
  const { prefs, setPref } = usePrefs();

  return (
    <SettingsPage>
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
        <ToggleRow
          title="Auto-play next chapter"
          subtitle="Keep going when a chapter ends."
          value={prefs.autoNextChapter}
          onChange={(v) => setPref('autoNextChapter', v)}
        />
      </Group>

      <SectionTitle>Movies & shows</SectionTitle>
      <Group>
        <ToggleRow
          title="Auto-play next episode"
          subtitle="Start the next episode when one ends (a Next button also shows near the end)."
          value={prefs.autoPlayNextEpisode}
          onChange={(v) => setPref('autoPlayNextEpisode', v)}
        />
        <ToggleRow
          title="Keep playing with the screen off"
          subtitle="Shows, movies, anime and live TV keep playing (sound) when the screen turns off or you switch apps. Audiobooks always do."
          value={prefs.backgroundVideo}
          onChange={(v) => setPref('backgroundVideo', v)}
        />
        <ToggleRow
          title="Resume where you left off"
          subtitle="Jump back to your last position when you reopen something."
          value={prefs.resumeVideos}
          onChange={(v) => setPref('resumeVideos', v)}
        />
        <ToggleRow
          title="TorBox cached streams first"
          subtitle="Show ⚡ streams that start instantly at the top of each addon."
          value={prefs.cachedFirst}
          onChange={(v) => setPref('cachedFirst', v)}
        />
      </Group>
      <SectionTitle>Subtitles</SectionTitle>
      <Group>
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
