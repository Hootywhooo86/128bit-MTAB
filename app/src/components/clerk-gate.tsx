import { ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import type { ReactNode } from 'react';

import { CLERK_PUBLISHABLE_KEY, clerkConfigured } from '@/lib/clerk';

/** Wraps the app in Clerk only when a key is set. Nothing waits on it. */
export function ClerkGate({ children }: { children: ReactNode }) {
  if (!clerkConfigured) return <>{children}</>;
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      {children}
    </ClerkProvider>
  );
}
