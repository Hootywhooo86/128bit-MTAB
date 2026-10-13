import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { SettingsPage } from '@/components/settings-ui';
import { Body, Button } from '@/components/ui';
import { useColors } from '@/constants/theme';
import { finishProviderSignIn } from '@/lib/account';

/** bit128://auth-callback: where Google / Apple sign-in comes back to. */
export default function AuthCallback() {
  const Colors = useColors();
  const { code, error_description: why } = useLocalSearchParams<{ code?: string; error_description?: string }>();
  const [error, setError] = useState<string | null>(why ?? (code ? null : 'Sign-in was cancelled.'));

  useEffect(() => {
    if (!code) return;
    finishProviderSignIn(code).then(
      () => router.replace('/settings/account'),
      (e) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [code]);

  return (
    <SettingsPage>
      {error ? (
        <>
          <Body style={{ color: Colors.danger }}>{error}</Body>
          <Button label="Back to Account" onPress={() => router.replace('/settings/account')} />
        </>
      ) : (
        <ActivityIndicator color={Colors.accent} />
      )}
    </SettingsPage>
  );
}
