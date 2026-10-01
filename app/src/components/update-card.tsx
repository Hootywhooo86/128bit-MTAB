import { useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { Button, Input } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { BUILD, checkForUpdate, setGithubToken, type UpdateCheck } from '@/lib/app-update';

/** About → Updates: is there a newer build on GitHub? */
export function UpdateCard() {
  const Colors = useColors();
  const styles = useStyles();
  const [result, setResult] = useState<UpdateCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState('');

  async function check() {
    setBusy(true);
    setError(null);
    try {
      setResult(await checkForUpdate());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.body}>
        You have build {BUILD || '(local)'}. Every change pushed to GitHub makes a new build.
      </Text>
      <Button label="Check for updates" onPress={check} loading={busy} />
      {result?.status === 'latest' ? (
        <Text style={{ color: Colors.success }}>You’re up to date.</Text>
      ) : null}
      {result?.status === 'available' ? (
        <>
          <Text style={[styles.body, { color: Colors.text }]}>
            Build {result.build} is ready ({result.name}).
          </Text>
          <Button
            label="Download & install"
            onPress={() => Linking.openURL(result.apkUrl ?? result.pageUrl)}
          />
          <Text style={styles.small}>
            It downloads in your browser (signed in to GitHub). Open the download and tap Install;
            it installs over this one and keeps everything.
          </Text>
        </>
      ) : null}
      {result?.status === 'needs-token' ? (
        <>
          <Text style={styles.body}>
            The app’s GitHub repo is private, so checking needs a read-only token: on GitHub,
            Settings → Developer settings → Fine-grained tokens → Generate. Pick only the
            128bit-MTAB repo and give it Contents: Read-only. Paste it here.
          </Text>
          <Button
            label="Create a token on GitHub"
            variant="secondary"
            onPress={() => Linking.openURL('https://github.com/settings/personal-access-tokens/new')}
          />
          <Input placeholder="github_pat_…" value={token} onChangeText={setToken} secureTextEntry autoCapitalize="none" />
          <Button
            label="Save & check"
            disabled={!token.trim()}
            onPress={async () => {
              await setGithubToken(token);
              setToken('');
              check();
            }}
          />
        </>
      ) : null}
      {error ? <Text style={{ color: Colors.danger }}>{error}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  card: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.three, gap: Spacing.three },
  body: { color: Colors.textSecondary, fontSize: 15, lineHeight: 21 },
  small: { color: Colors.textSecondary, fontSize: 12 },
}));
