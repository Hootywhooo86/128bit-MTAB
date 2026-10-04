import { useState, type ComponentProps } from 'react';
import { Pressable as RNPressable, StyleSheet, View } from 'react-native';

import { useColors } from '@/constants/theme';
import { IS_TV } from '@/constants/tv';

type Props = ComponentProps<typeof RNPressable>;

/**
 * Pressable that shows a ring in the accent colour while the TV remote's focus is on it.
 * On phones it is a plain Pressable.
 */
export function Pressable(props: Props) {
  if (!IS_TV) return <RNPressable {...props} />;
  return <TvPressable {...props} />;
}

function TvPressable({ children, onFocus, onBlur, ...rest }: Props) {
  const Colors = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <RNPressable
      {...rest}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}>
      {(state) => (
        <>
          {typeof children === 'function' ? children(state) : children}
          {focused ? (
            <View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { borderWidth: 3, borderColor: Colors.accent, borderRadius: 4 }]}
            />
          ) : null}
        </>
      )}
    </RNPressable>
  );
}
