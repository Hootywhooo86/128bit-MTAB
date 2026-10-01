import { Redirect } from 'expo-router';

/** The app opens on Audiobooks. */
export default function Index() {
  return <Redirect href="/audiobooks" />;
}
