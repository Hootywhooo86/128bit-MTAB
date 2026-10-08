import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import makeQr from 'qrcode-generator';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';

import { Group, Row, SectionTitle, SettingsPage } from '@/components/settings-ui';
import { Body, Button, Input } from '@/components/ui';
import { PixelFont, Spacing, makeStyles, useColors } from '@/constants/theme';
import { IS_TV } from '@/constants/tv';
import {
  SETUP_SQL,
  claimTv,
  deleteAccount,
  finishTvPairing,
  getProject,
  getSession,
  lastSyncTime,
  onAccount,
  pairLink,
  projectBuiltIn,
  setProject,
  signIn,
  signOut,
  signUp,
  startProviderSignIn,
  startTvPairing,
  syncNow,
  tvLinkedTo,
  type Project,
  type Session,
} from '@/lib/account';

const SECTION_NAMES: Record<string, string> = {
  addons: 'add-ons',
  prefs: 'settings',
  live: 'Live TV',
  watching: 'Continue watching',
  integrations: 'TorBox/TMDB',
  tracking: 'Trakt/Simkl',
  books: 'books',
  comics: 'comics',
};

/** Settings → Account: your own Supabase project, sign-in, sync, and pairing a TV. */
export default function AccountSettings() {
  const Colors = useColors();
  const styles = useStyles();
  const { pair } = useLocalSearchParams<{ pair?: string }>();
  const [project, setProj] = useState<Project | null | undefined>(undefined);
  const [session, setSess] = useState<Session | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  const refresh = useCallback(() => {
    getProject().then(setProj);
    getSession().then(setSess);
    lastSyncTime().then(setLast);
  }, []);
  useEffect(() => {
    refresh();
    return onAccount(refresh);
  }, [refresh]);

  async function run(fn: () => Promise<string | void>) {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ text });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), bad: true });
    } finally {
      setBusy(false);
      refresh();
    }
  }

  const note = msg ? (
    <Body style={{ color: msg.bad ? Colors.danger : Colors.success, fontSize: 13 }}>{msg.text}</Body>
  ) : null;

  if (project === undefined) {
    return (
      <SettingsPage>
        <ActivityIndicator color={Colors.accent} />
      </SettingsPage>
    );
  }

  const signedIn = session && !session.user.is_anonymous;
  const tvLinked = !!session?.user.is_anonymous && !!session.linkedTo;

  return (
    <SettingsPage>
      <Body muted style={styles.intro}>
        Sign in on your phone, another phone or the TV app and your add-ons, settings, Live TV
        playlists, TorBox/Trakt/Simkl connections and Continue watching come with you
        {IS_TV ? '' : ' (plus books and comics on phones)'}. It&apos;s your 128bit family account: the
        same sign-in works in 128bitfit, 128bit Tracker and the rest, and what you finish shows on
        Tracker&apos;s timeline.
      </Body>

      {!project ? (
        <ProjectForm onSaved={refresh} />
      ) : signedIn || tvLinked ? (
        <>
          <SectionTitle>Signed in</SectionTitle>
          <Group>
            <Row icon="person-circle" title={session.user.email ?? `${session.linkedTo} (this TV)`} subtitle={
              last ? `Last synced ${new Date(last).toLocaleString()}` : 'Not synced yet'
            } />
            <Row
              icon="sync"
              title="Sync now"
              subtitle="Pull changes from your other devices and send this one's"
              onPress={() =>
                run(async () => {
                  const r = await syncNow();
                  if (!r) return 'Nothing to sync.';
                  const names = (l: string[]) => l.map((n) => SECTION_NAMES[n] ?? n).join(', ');
                  return [
                    r.pulled.length ? `Got ${names(r.pulled)}` : '',
                    r.pushed.length ? `Sent ${names(r.pushed)}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Everything is up to date.';
                })
              }
            />
            <Row
              icon="log-out"
              title="Sign out"
              danger
              onPress={() => run(async () => {
                await signOut();
                return 'Signed out. Your settings stay on this device.';
              })}
            />
            {signedIn ? (
              <Row
                icon="trash"
                title="Delete account"
                subtitle="Removes it from every 128bit app; this device keeps its own copy"
                danger
                onPress={() =>
                  Alert.alert(
                    'Delete your 128bit family account?',
                    'Your synced settings, timeline and keys are deleted for good, in every 128bit app. What is on this device stays.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: () => run(async () => {
                          await deleteAccount();
                          return 'Account deleted.';
                        }),
                      },
                    ],
                  )
                }
              />
            ) : null}
          </Group>
          {signedIn && !IS_TV ? <PairTv initial={pair} /> : null}
        </>
      ) : (
        <>
          {IS_TV ? <TvPairing /> : null}
          <SignInForm busy={busy} run={run} />
        </>
      )}
      {busy ? <ActivityIndicator color={Colors.accent} /> : null}
      {note}

      {project && !IS_TV ? (
        <>
          <SectionTitle>Supabase project</SectionTitle>
          <Group>
            <Row icon="server" title={project.url.replace('https://', '')} subtitle={projectBuiltIn ? 'Built into this app' : 'Added on this device'} />
            <Row
              icon="copy"
              title="Copy setup SQL"
              subtitle="Run it once in Supabase → SQL Editor"
              onPress={() => run(async () => {
                await Clipboard.setStringAsync(SETUP_SQL);
                return 'Setup SQL copied.';
              })}
            />
            {!projectBuiltIn ? (
              <Row icon="close-circle" title="Use a different project" danger onPress={() => run(async () => {
                await signOut();
                await setProject(null);
              })} />
            ) : null}
          </Group>
        </>
      ) : null}
    </SettingsPage>
  );
}

function ProjectForm({ onSaved }: { onSaved: () => void }) {
  const Colors = useColors();
  const styles = useStyles();
  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <View style={styles.box}>
      <Text style={styles.heading}>SET UP (ONCE)</Text>
      <Body style={styles.step}>1. supabase.com → New project (free).</Body>
      <Body style={styles.step}>2. SQL Editor → paste the setup SQL (copy below) → Run.</Body>
      <Body style={styles.step}>
        3. Authentication → Sign In / Providers: turn on Anonymous sign-ins (for TVs), and turn off
        Confirm email (otherwise the email’s link opens a “localhost:3000” error page; harmless, the
        account still gets confirmed).
      </Body>
      <Body style={styles.step}>4. Settings → API: copy the Project URL and the anon public key here.</Body>
      <Button
        label={copied ? '✓ Setup SQL copied' : 'Copy setup SQL'}
        variant="secondary"
        onPress={async () => {
          await Clipboard.setStringAsync(SETUP_SQL);
          setCopied(true);
        }}
      />
      <Input placeholder="Project URL (https://….supabase.co)" value={url} onChangeText={setUrl} keyboardType="url" />
      <Input placeholder="anon public key" value={anonKey} onChangeText={setAnonKey} />
      {error ? <Body style={{ color: Colors.danger, fontSize: 13 }}>{error}</Body> : null}
      <Button
        label="Save project"
        onPress={async () => {
          try {
            await setProject({ url, anonKey });
            onSaved();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      />
    </View>
  );
}

function SignInForm({ busy, run }: { busy: boolean; run: (fn: () => Promise<string | void>) => void }) {
  const styles = useStyles();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <View style={styles.box}>
      <Text style={styles.heading}>{IS_TV ? 'OR SIGN IN HERE' : '128BIT FAMILY ACCOUNT'}</Text>
      {IS_TV ? null : (
        <>
          <Button label="Continue with Google" disabled={busy} onPress={() => run(() => startProviderSignIn('google'))} />
          <Button
            label="Continue with Apple"
            variant="secondary"
            disabled={busy}
            onPress={() => run(() => startProviderSignIn('apple'))}
          />
          <Body muted style={{ fontSize: 13 }}>Or with email:</Body>
        </>
      )}
      <Input placeholder="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
      <Input placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
      <Button label="Sign in" disabled={busy || !email || !password} onPress={() => run(() => signIn(email, password))} />
      <Button
        label="Create account"
        variant="secondary"
        disabled={busy || !email || password.length < 6}
        onPress={() =>
          run(async () =>
            (await signUp(email, password))
              ? undefined
              : 'Account created. Tap the link in the email Supabase sent (if it opens a “localhost:3000” error page, that’s fine: you’re confirmed), then come back and tap Sign in.',
          )
        }
      />
    </View>
  );
}

/** TV: show a code + QR; a signed-in phone enters or scans it. */
function TvPairing() {
  const Colors = useColors();
  const styles = useStyles();
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    startTvPairing().then(
      (c) => alive && setCode(c),
      (e) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, []);

  // Wait for the phone to claim the code.
  useEffect(() => {
    if (!code || linked) return;
    const t = setInterval(async () => {
      const email = await tvLinkedTo().catch(() => null);
      if (email) {
        setLinked(email);
        await finishTvPairing().catch(() => {});
      }
    }, 3000);
    return () => clearInterval(t);
  }, [code, linked]);

  return (
    <View style={[styles.box, { alignItems: 'center' }]}>
      <Text style={styles.heading}>SIGN IN WITH YOUR PHONE</Text>
      {error ? <Body style={{ color: Colors.danger }}>{error}</Body> : null}
      {linked ? (
        <Body style={{ color: Colors.success, fontSize: 18 }}>Signed in as {linked}. Bringing your settings over…</Body>
      ) : code ? (
        <>
          <Qr text={pairLink(code)} size={220} />
          <Text style={styles.code}>{code}</Text>
          <Body muted style={{ textAlign: 'center' }}>
            Scan this with your phone, or open 128bitPlay on the phone → Settings → Account → Sign in a
            TV, and enter the code.
          </Body>
        </>
      ) : !error ? (
        <ActivityIndicator color={Colors.accent} />
      ) : null}
    </View>
  );
}

/** Phone: enter (or arrive from the QR with) the code the TV shows. */
function PairTv({ initial }: { initial?: string }) {
  const Colors = useColors();
  const styles = useStyles();
  const [code, setCode] = useState(initial ?? '');
  const [state, setState] = useState<{ text: string; bad?: boolean } | null>(null);
  return (
    <View style={styles.box}>
      <Text style={styles.heading}>SIGN IN A TV</Text>
      <Body muted style={{ fontSize: 13 }}>
        Open 128bitPlay TV → Settings → Account. Scan its QR code with this phone, or type the code
        it shows.
      </Body>
      <Input
        placeholder="Code from the TV (e.g. K7Q2M9)"
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        autoCapitalize="characters"
        maxLength={6}
      />
      <Button
        label="Sign in the TV"
        disabled={code.length !== 6}
        onPress={async () => {
          setState(null);
          try {
            await claimTv(code);
            setState({ text: 'Done: the TV is signed in and is bringing your settings over.' });
          } catch (e) {
            setState({ text: e instanceof Error ? e.message : String(e), bad: true });
          }
        }}
      />
      {state ? <Body style={{ color: state.bad ? Colors.danger : Colors.success, fontSize: 13 }}>{state.text}</Body> : null}
    </View>
  );
}

/** A QR code drawn with plain views (black on white, with a quiet zone). */
function Qr({ text, size }: { text: string; size: number }) {
  const rows = useMemo(() => {
    const q = makeQr(0, 'M');
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
  }, [text]);
  const cell = Math.floor(size / (rows.length + 4));
  return (
    <View style={{ backgroundColor: '#fff', padding: cell * 2 }}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row' }}>
          {row.map((dark, c) => (
            <View key={c} style={{ width: cell, height: cell, backgroundColor: dark ? '#000' : '#fff' }} />
          ))}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  intro: { fontSize: 13, marginBottom: Spacing.two },
  box: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    marginBottom: Spacing.three,
  },
  heading: { color: Colors.accent, fontFamily: PixelFont, fontSize: 11, marginBottom: Spacing.one },
  step: { fontSize: 13 },
  code: { color: Colors.text, fontFamily: PixelFont, fontSize: 32, letterSpacing: 6, marginTop: Spacing.two },
}));
