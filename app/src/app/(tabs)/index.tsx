import { Redirect } from 'expo-router';

import { IS_TV } from '@/constants/tv';

/** The app opens on Audiobooks (the TV app on Shows). */
export default function Index() {
  return <Redirect href={IS_TV ? '/shows' : '/audiobooks'} />;
}
