import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, View } from 'react-native';

import { Spacing, useColors } from '@/constants/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export type HeaderAction = { icon: IconName; label: string; onPress: () => void };

/** Icons on the right of a tab's header. Settings is always last. */
export function HeaderButtons({ actions = [] }: { actions?: HeaderAction[] }) {
  const Colors = useColors();
  const all: HeaderAction[] = [
    ...actions,
    { icon: 'settings-outline', label: 'Settings', onPress: () => router.push('/settings') },
  ];
  return (
    <View style={{ flexDirection: 'row', gap: Spacing.four, marginRight: Spacing.three }}>
      {all.map((a) => (
        <Pressable key={a.label} onPress={a.onPress} hitSlop={12} accessibilityLabel={a.label}>
          <Ionicons name={a.icon} size={24} color={Colors.text} />
        </Pressable>
      ))}
    </View>
  );
}
