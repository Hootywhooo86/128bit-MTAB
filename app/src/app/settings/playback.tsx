import { ChoiceRow, Group, SectionTitle, SettingsPage, ToggleRow } from '@/components/settings-ui';
import { usePrefs } from '@/lib/prefs';

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
    </SettingsPage>
  );
}
