import { Platform } from 'react-native';

/**
 * The Android TV app ("128bitPlay TV", built with EXPO_TV=1 / EXPO_PUBLIC_TV=1): video
 * only (Shows, Movies, Anime, Live TV), driven by a remote. The phone APK also turns
 * into this when it runs on a TV.
 */
export const IS_TV = process.env.EXPO_PUBLIC_TV === '1' || Platform.isTV === true;
