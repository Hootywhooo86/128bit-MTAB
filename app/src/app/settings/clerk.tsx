import { useAuth, useClerk, useSSO, useUser } from '@clerk/expo';
import { useHostedAuth } from '@clerk/expo/hosted-auth';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';

import { Group, Row, SettingsPage } from '@/components/settings-ui';
import { Body, Button } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { clerkConfigured } from '@/lib/clerk';

// Closes the Google tab when it hands back to the app.
WebBrowser.maybeCompleteAuthSession();

/**
 * Settings → Clerk account: a second way to sign in, beside Account & sync. Email or
 * Google, the person picks; Google is never required.
 */
export default function ClerkSettings() {
  if (!clerkConfigured) {
    return (
      <SettingsPage>
        <Body muted style={{ padding: Spacing.three }}>
          Clerk sign-in isn&apos;t set up in this build yet. Account &amp; sync still works.
        </Body>
      </SettingsPage>
    );
  }
  return <ClerkAccount />;
}

function ClerkAccount() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { startHostedAuth } = useHostedAuth();
  const { startSSOFlow } = useSSO();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Clerk account', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const withEmail = () => run('email', () => startHostedAuth({ mode: 'sign-in' }));

  const withGoogle = () =>
    run('google', async () => {
      const { createdSessionId, setActive } = await startSSOFlow({ strategy: 'oauth_google' });
      if (createdSessionId && setActive) await setActive({ session: createdSessionId });
    });

  const confirmSignOut = () =>
    Alert.alert('Sign out of Clerk?', 'Nothing on this phone is deleted.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void run('signout', () => signOut()) },
    ]);

  if (!isLoaded) {
    return (
      <SettingsPage>
        <View style={{ padding: Spacing.four, alignItems: 'center', gap: Spacing.three }}>
          <ActivityIndicator />
          <Body muted>Needs a connection the first time.</Body>
        </View>
      </SettingsPage>
    );
  }

  if (!isSignedIn) {
    return (
      <SettingsPage>
        <View style={{ padding: Spacing.three, gap: Spacing.three }}>
          <Body muted>
            Sign in with your email, or with Google if you&apos;d rather. Either works; Google is optional. New here?
            Either button creates your account. This is separate from Account &amp; sync for now.
          </Body>
          <Button label="Continue with email" loading={busy === 'email'} disabled={!!busy} onPress={withEmail} />
          <Button
            label="Continue with Google"
            variant="secondary"
            loading={busy === 'google'}
            disabled={!!busy}
            onPress={withGoogle}
          />
        </View>
      </SettingsPage>
    );
  }

  return (
    <SettingsPage>
      <Group>
        <Row icon="person-circle" title="Signed in" subtitle={user?.primaryEmailAddress?.emailAddress ?? 'Clerk account'} />
        <Row icon="log-out" title="Sign out" danger onPress={busy ? undefined : confirmSignOut} />
      </Group>
    </SettingsPage>
  );
}
