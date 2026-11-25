import { useState, type ComponentProps } from 'react';
import { Pressable as RNPressable, StyleSheet, View, type PressableStateCallbackType, type StyleProp, type ViewStyle } from 'react-native';

import { useColors } from '@/constants/theme';
import { IS_TV } from '@/constants/tv';

type Props = ComponentProps<typeof RNPressable>;

/**
 * Pressable that lights up while the TV remote's focus is on it: it grows a little and gets
 * a thick pixel border in the accent colour with a hard pixel shadow, so you always know
 * where you are. On phones it is a plain Pressable.
 */
export function Pressable(props: Props) {
  if (!IS_TV) return <RNPressable {...props} />;
  return <TvPressable {...props} />;
}

function TvPressable({ children, onFocus, onBlur, style, ...rest }: Props) {
  const Colors = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <RNPressable
      {...rest}
      style={(state: PressableStateCallbackType): StyleProp<ViewStyle> => [
        typeof style === 'function' ? style(state) : style,
        // On top of its neighbours, a touch bigger.
        focused && { transform: [{ scale: 1.06 }], zIndex: 10, elevation: 10 },
      ]}
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
              style={[
                StyleSheet.absoluteFill,
                {
                  borderWidth: 4,
                  borderColor: Colors.accent,
                  // A soft wash of the accent colour, and a hard pixel shadow under the ring.
                  backgroundColor: `${Colors.accent}22`,
                  boxShadow: `4px 4px 0px #000000`,
                },
              ]}
            />
          ) : null}
        </>
      )}
    </RNPressable>
  );
}
