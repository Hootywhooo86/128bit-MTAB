import { ScrollView } from 'react-native';

import { CalendarList } from '@/components/calendar';
import { useColors } from '@/constants/theme';

/** Calendar: new episodes of the shows and anime you watch or have planned, day by day. */
export default function CalendarScreen() {
  const Colors = useColors();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: Colors.background }}>
      <CalendarList />
    </ScrollView>
  );
}
