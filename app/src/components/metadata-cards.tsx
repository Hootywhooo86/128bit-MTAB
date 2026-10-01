import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

import { Button, Input } from '@/components/ui';
import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import {
  RATING_SOURCES,
  getMdblistKey,
  getRatingSources,
  setMdblistKey,
  setRatingSources,
  type RatingSourceId,
} from '@/lib/mdblist';
import { getTmdbKey, setTmdbKey } from '@/lib/tmdb';

/** Shared "paste a key, test it, save it" card. */
function KeyCard({
  title,
  body,
  connectedBody,
  placeholder,
  getUrl,
  linkLabel,
  load,
  save,
  children,
}: {
  title: string;
  body: string;
  connectedBody: string;
  placeholder: string;
  getUrl: string;
  linkLabel: string;
  load: () => Promise<string | null | undefined>;
  save: (key: string) => Promise<void>;
  children?: ReactNode;
}) {
  const Colors = useColors();
  const styles = useStyles();
  const [saved, setSaved] = useState<boolean | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load().then((k) => setSaved(!!k));
  }, [load]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await save(value);
      setSaved(true);
      setValue('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {saved ? (
        <>
          <Text style={{ color: Colors.success }}>Connected</Text>
          <Text style={styles.body}>{connectedBody}</Text>
          {children}
          <Button
            label="Remove key"
            variant="danger"
            onPress={async () => {
              await save('');
              setSaved(false);
            }}
          />
        </>
      ) : (
        <>
          <Text style={styles.body}>{body}</Text>
          <Input
            placeholder={placeholder}
            value={value}
            onChangeText={setValue}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          {error ? <Text style={{ color: Colors.danger }}>{error}</Text> : null}
          <Button label="Save & test" onPress={submit} loading={busy} disabled={!value.trim()} />
          <Button label={linkLabel} variant="secondary" onPress={() => Linking.openURL(getUrl)} />
        </>
      )}
    </View>
  );
}

export function TmdbCard() {
  return (
    <KeyCard
      title="TMDB"
      body="Richer title pages: cast with photos, trailer, age rating, runtime, seasons, network and “More like this”. Paste your free TMDB API key (or read access token)."
      connectedBody="Movies and shows now show cast, trailers, age ratings and recommendations."
      placeholder="TMDB API key or read access token"
      getUrl="https://www.themoviedb.org/settings/api"
      linkLabel="Get a TMDB key"
      load={getTmdbKey}
      save={setTmdbKey}
    />
  );
}

export function MdblistCard() {
  const Colors = useColors();
  const styles = useStyles();
  const [sources, setSources] = useState<RatingSourceId[]>([]);

  useEffect(() => {
    getRatingSources().then(setSources);
  }, []);

  function toggle(id: RatingSourceId) {
    const next = sources.includes(id) ? sources.filter((s) => s !== id) : [...sources, id];
    setSources(next);
    setRatingSources(next);
  }

  return (
    <KeyCard
      title="MDBList"
      body="Ratings from IMDb, Rotten Tomatoes, Metacritic, Letterboxd, Trakt and more on every movie and show. Paste your free MDBList API key."
      connectedBody="Pick which ratings to show on title pages:"
      placeholder="MDBList API key"
      getUrl="https://mdblist.com/preferences/"
      linkLabel="Get an MDBList key"
      load={getMdblistKey}
      save={setMdblistKey}>
      <View style={styles.chips}>
        {RATING_SOURCES.map((s) => {
          const on = sources.includes(s.id);
          return (
            <Pressable
              key={s.id}
              onPress={() => toggle(s.id)}
              style={[styles.chip, on && { backgroundColor: Colors.accent }]}>
              <Text style={[styles.chipText, on && { color: Colors.accentText }]}>{s.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </KeyCard>
  );
}

const useStyles = makeStyles((Colors) => ({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  title: { color: Colors.text, fontSize: 22, fontWeight: '800' },
  body: { color: Colors.textSecondary, fontSize: 15, lineHeight: 21 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceRaised,
  },
  chipText: { color: Colors.text, fontWeight: '700', fontSize: 13 },
}));
