import { Platform } from 'react-native';

/**
 * The Android TV app ("128bitPlay TV", built with EXPO_TV=1 / EXPO_PUBLIC_TV=1): video
 * only (Shows, Movies, Anime, Sports), driven by a remote. The phone APK also turns
 * into this when it runs on a TV.
 */
export const IS_TV = process.env.EXPO_PUBLIC_TV === '1' || Platform.isTV === true;

/** Audiobooks are a phone thing: not on the TV app or the Windows app (the web build). */
export const HAS_BOOKS = !IS_TV && Platform.OS !== 'web';

/** Comics: phones and Windows, not the TV app. */
export const HAS_COMICS = !IS_TV;
