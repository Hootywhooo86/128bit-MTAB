import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';

import { ChoiceRow, Group, SectionTitle, SettingsPage, ToggleRow } from '@/components/settings-ui';
import { Button, Input } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { getComicSites, setComicSites } from '@/lib/comic-grab';
import { comicImage } from '@/lib/comics';
import { usePrefs } from '@/lib/prefs';
import {
  KEIYOUSHI_REPO,
  addRepo,
  changeExtension,
  connectSuwayomi,
  disconnectSuwayomi,
  getRepos,
  getSuwayomi,
  listExtensions,
  refreshExtensions,
  removeRepo,
  suwayomiUrl,
  updateAllExtensions,
  type Extension,
} from '@/lib/suwayomi';

type Filter = 'installed' | 'available' | 'updates';
const SHOW_MAX = 80;

/** The sites behind Comics → Find; change them if one moves to a new address. */
function SitesCard() {
  const styles = useStyles();
  const Colors = useColors();
  const [gc, setGc] = useState('');
  const [tpb, setTpb] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    getComicSites().then((s) => {
      setGc(s.getcomics);
      setTpb(s.tpb);
    });
  }, []);
  return (
    <View style={styles.card}>
      <Text style={styles.body}>
        GetComics downloads straight to the phone. Pirate Bay torrents (Comics category) go to
        TorBox first, then to the phone. Change an address here if a site moves (TPB needs its
        apibay-style API address).
      </Text>
      <Input value={gc} onChangeText={setGc} placeholder="https://getcomics.org" autoCapitalize="none" />
      <Input value={tpb} onChangeText={setTpb} placeholder="https://apibay.org" autoCapitalize="none" />
      <Button
        label="Save addresses"
        variant="secondary"
        onPress={async () => {
          await setComicSites({ getcomics: gc, tpb });
          const s = await getComicSites();
          setGc(s.getcomics);
          setTpb(s.tpb);
          setSaved(true);
        }}
      />
      {saved ? <Text style={{ color: Colors.success }}>Saved</Text> : null}
    </View>
  );
}

export default function ComicsSettings() {
  const Colors = useColors();
  const styles = useStyles();
  const { prefs, setPref } = usePrefs();
  const [server, setServer] = useState<string | null | undefined>(undefined);
  const [version, setVersion] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repos, setRepos] = useState<string[]>([]);
  const [repoUrl, setRepoUrl] = useState('');
  const [exts, setExts] = useState<Extension[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [filter, setFilter] = useState<Filter>('installed');
  const [query, setQuery] = useState('');
  const [englishOnly, setEnglishOnly] = useState(true);

  const loadServerData = useCallback(async () => {
    try {
      setRepos(await getRepos());
      setExts(await listExtensions());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    getSuwayomi().then((c) => {
      setServer(c?.url ?? null);
      if (c) loadServerData();
    });
  }, [loadServerData]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const connect = () =>
    run('connect', async () => {
      const v = await connectSuwayomi({ url, username: user.trim() || undefined, password: pass || undefined });
      setVersion(v);
      setServer((await getSuwayomi())?.url ?? null);
      setPass('');
      await loadServerData();
    });

  const updateRepos = () =>
    run('refresh', async () => {
      setExts(await refreshExtensions());
      setCheckedAt(new Date());
    });

  const act = (e: Extension, action: 'install' | 'update' | 'uninstall') =>
    run(`${action}:${e.pkgName}`, async () => {
      await changeExtension(e.pkgName, action);
      setExts(await listExtensions());
    });

  const updates = (exts ?? []).filter((e) => e.isInstalled && e.hasUpdate);
  const q = query.trim().toLowerCase();
  const shown = (exts ?? [])
    .filter((e) =>
      filter === 'installed' ? e.isInstalled : filter === 'updates' ? e.isInstalled && e.hasUpdate : !e.isInstalled,
    )
    .filter((e) => !englishOnly || e.lang === 'en' || e.lang === 'all' || e.lang === 'multi')
    .filter((e) => !q || e.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <SettingsPage>
      <SectionTitle>Suwayomi server</SectionTitle>
      <View style={styles.card}>
        {server === undefined ? (
          <ActivityIndicator color={Colors.accent} />
        ) : server ? (
          <>
            <Text style={{ color: Colors.success }}>Connected{version ? ` · ${version}` : ''}</Text>
            <Text style={styles.small}>{server}</Text>
            <Button
              label="Disconnect"
              variant="danger"
              onPress={async () => {
                await disconnectSuwayomi();
                setServer(null);
                setExts(null);
                setRepos([]);
              }}
            />
          </>
        ) : (
          <>
            <Text style={styles.body}>
              Mihon extensions (like the Keiyoushi repo) are Android plug-ins that only Mihon-style
              apps can run. Suwayomi runs them for you on a computer, NAS or ElfHosted; connect it
              here to pick repos, install extensions and read their comics in 128bit.
            </Text>
            <Input placeholder="Server address, e.g. http://192.168.1.20:4567" value={url} onChangeText={setUrl} keyboardType="url" autoCapitalize="none" />
            <Input placeholder="Username (if your server has one)" value={user} onChangeText={setUser} autoCapitalize="none" />
            <Input placeholder="Password" value={pass} onChangeText={setPass} secureTextEntry />
            <Button label="Connect" onPress={connect} loading={busy === 'connect'} disabled={!url.trim()} />
            <Button
              label="What is Suwayomi?"
              variant="secondary"
              onPress={() => Linking.openURL('https://github.com/Suwayomi/Suwayomi-Server#readme')}
            />
          </>
        )}
        {error ? <Text style={{ color: Colors.danger }}>{error}</Text> : null}
      </View>

      {server ? (
        <>
          <SectionTitle>Extension repos</SectionTitle>
          <View style={styles.card}>
            {repos.map((r) => (
              <View key={r} style={styles.row}>
                <Ionicons name="git-branch-outline" size={18} color={Colors.accent} />
                <Text style={[styles.small, { flex: 1 }]} numberOfLines={2}>
                  {r === KEIYOUSHI_REPO ? 'Keiyoushi' : r}
                </Text>
                <Pressable hitSlop={10} onPress={() => run('repo', async () => { await removeRepo(r); setRepos(await getRepos()); })} accessibilityLabel="Remove repo">
                  <Ionicons name="trash-outline" size={20} color={Colors.danger} />
                </Pressable>
              </View>
            ))}
            {!repos.includes(KEIYOUSHI_REPO) ? (
              <Button
                label="Add Keiyoushi repo"
                loading={busy === 'keiyoushi'}
                onPress={() =>
                  run('keiyoushi', async () => {
                    await addRepo(KEIYOUSHI_REPO);
                    setRepos(await getRepos());
                    setExts(await refreshExtensions());
                    setCheckedAt(new Date());
                    setFilter('available');
                  })
                }
              />
            ) : null}
            <Input placeholder="Another repo URL (…/index.min.json)" value={repoUrl} onChangeText={setRepoUrl} keyboardType="url" autoCapitalize="none" />
            <Button
              label="Add repo"
              variant="secondary"
              disabled={!repoUrl.trim()}
              loading={busy === 'repo'}
              onPress={() =>
                run('repo', async () => {
                  await addRepo(repoUrl);
                  setRepoUrl('');
                  setRepos(await getRepos());
                })
              }
            />
            <Button label="Update repos" onPress={updateRepos} loading={busy === 'refresh'} />
            <Text style={styles.small}>
              {checkedAt
                ? `Checked GitHub at ${checkedAt.toLocaleTimeString()} · ${exts?.length ?? 0} extensions · ${updates.length} updates`
                : 'Gets the newest extension list from each repo on GitHub.'}
            </Text>
            {updates.length ? (
              <Button
                label={`Update all (${updates.length})`}
                loading={busy === 'all'}
                onPress={() =>
                  run('all', async () => {
                    await updateAllExtensions(updates.map((u) => u.pkgName));
                    setExts(await listExtensions());
                  })
                }
              />
            ) : null}
          </View>

          <SectionTitle>Extensions</SectionTitle>
          <View style={styles.card}>
            <View style={styles.chips}>
              {(['installed', 'available', 'updates'] as const).map((f) => (
                <Pressable key={f} onPress={() => setFilter(f)} style={[styles.chip, filter === f && { backgroundColor: Colors.accent }]}>
                  <Text style={[styles.chipText, filter === f && { color: Colors.accentText }]}>
                    {f === 'installed' ? 'Installed' : f === 'available' ? 'Available' : `Updates (${updates.length})`}
                  </Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setEnglishOnly(!englishOnly)} style={[styles.chip, englishOnly && { backgroundColor: Colors.accent }]}>
                <Text style={[styles.chipText, englishOnly && { color: Colors.accentText }]}>English only</Text>
              </Pressable>
            </View>
            <Input placeholder="Search extensions" value={query} onChangeText={setQuery} />
            {!exts ? <ActivityIndicator color={Colors.accent} /> : null}
            {exts && shown.length === 0 ? (
              <Text style={styles.small}>
                {filter === 'installed' ? 'No extensions installed yet. Open Available.' : 'Nothing here.'}
              </Text>
            ) : null}
            {shown.slice(0, SHOW_MAX).map((e) => (
              <View key={e.pkgName} style={styles.row}>
                <View style={styles.icon}>
                  {e.iconUrl ? (
                    <Image source={comicImage(suwayomiUrl(e.iconUrl))} style={{ width: 36, height: 36 }} />
                  ) : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {e.name}
                    {e.isNsfw ? '  18+' : ''}
                  </Text>
                  <Text style={styles.small}>
                    {e.lang} · v{e.versionName}
                  </Text>
                </View>
                {busy?.endsWith(`:${e.pkgName}`) ? (
                  <ActivityIndicator color={Colors.accent} />
                ) : e.isInstalled ? (
                  <View style={{ flexDirection: 'row', gap: Spacing.three }}>
                    {e.hasUpdate ? (
                      <Pressable onPress={() => act(e, 'update')} hitSlop={8}>
                        <Text style={styles.action}>Update</Text>
                      </Pressable>
                    ) : null}
                    <Pressable onPress={() => act(e, 'uninstall')} hitSlop={8}>
                      <Text style={[styles.action, { color: Colors.danger }]}>Remove</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable onPress={() => act(e, 'install')} hitSlop={8}>
                    <Text style={styles.action}>Install</Text>
                  </Pressable>
                )}
              </View>
            ))}
            {shown.length > SHOW_MAX ? (
              <Text style={styles.small}>Showing {SHOW_MAX} of {shown.length}. Search to find others.</Text>
            ) : null}
          </View>
        </>
      ) : null}

      <SectionTitle>Reader</SectionTitle>
      <Group>
        <ChoiceRow
          title="Reading mode"
          value={prefs.readerMode}
          options={[
            { value: 'vertical', label: 'Scroll down' },
            { value: 'rtl', label: 'Pages, right to left' },
            { value: 'ltr', label: 'Pages, left to right' },
          ]}
          onChange={(v) => setPref('readerMode', v)}
        />
        <ToggleRow
          title="Sources in all languages"
          subtitle="Off: the Comics tab lists English and multi-language sources only."
          value={prefs.comicAllLanguages}
          onChange={(v) => setPref('comicAllLanguages', v)}
        />
        <ToggleRow
          title="Delete chapters after reading"
          subtitle="Saves space: a downloaded or imported chapter leaves the phone once you've finished it (when you finish the next one)."
          value={prefs.comicDeleteRead}
          onChange={(v) => setPref('comicDeleteRead', v)}
        />
        <ToggleRow
          title="Data saver (MangaDex)"
          subtitle="Smaller, compressed pages."
          value={prefs.comicDataSaver}
          onChange={(v) => setPref('comicDataSaver', v)}
        />
      </Group>

      <SectionTitle>Find comics (GetComics · Pirate Bay)</SectionTitle>
      <SitesCard />
    </SettingsPage>
  );
}

const useStyles = makeStyles((Colors) => ({
  card: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.three, gap: Spacing.three },
  body: { color: Colors.textSecondary, fontSize: 15, lineHeight: 21 },
  small: { color: Colors.textSecondary, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  icon: { width: 36, height: 36, borderRadius: 8, overflow: 'hidden', backgroundColor: Colors.surfaceRaised },
  name: { color: Colors.text, fontWeight: '600', fontSize: 15 },
  action: { color: Colors.accent, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Radius.lg, backgroundColor: Colors.surfaceRaised },
  chipText: { color: Colors.text, fontWeight: '700', fontSize: 13 },
}));
