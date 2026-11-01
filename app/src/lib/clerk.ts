/**
 * Clerk sign-in, offered next to Account & sync (your Supabase project) rather than
 * replacing it. The publishable key is public; without one the app runs as before and
 * Settings → Clerk account says sign-in isn't set up. Phones only: the TV app has no
 * browser to sign in with.
 */
import { IS_TV } from '@/constants/tv';

export const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';

export const clerkConfigured = !IS_TV && CLERK_PUBLISHABLE_KEY.startsWith('pk_');
