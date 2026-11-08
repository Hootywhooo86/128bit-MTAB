import { Redirect } from 'expo-router';

import { HAS_BOOKS } from '@/constants/tv';

/** The app opens on Audiobooks (the TV and Windows apps, which have none, on Shows). */
export default function Index() {
  return <Redirect href={HAS_BOOKS ? '/audiobooks' : '/shows'} />;
}
