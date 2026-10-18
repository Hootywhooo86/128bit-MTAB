import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useColors } from '@/constants/theme';

/** A pixel-art ▶: rows 1-2-3-4-5-4-3-2-1 blocks wide on a 9-row grid. */
export function PixelPlay({ size = 18, color }: { size?: number; color: string }) {
  const px = size / 9;
  return (
    <View style={{ width: Math.ceil(px * 5), height: size }}>
      {Array.from({ length: 9 }, (_, y) => (
        <View
          key={y}
          style={{ position: 'absolute', left: 0, top: y * px, width: (Math.min(y, 8 - y) + 1) * px, height: Math.ceil(px), backgroundColor: color }}
        />
      ))}
    </View>
  );
}

/** A pixel-art +: two arms, 2 blocks thick, on an 8×8 grid. */
export function PixelPlus({ size = 20, color }: { size?: number; color: string }) {
  const px = size / 8;
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ position: 'absolute', left: 0, top: 3 * px, width: size, height: 2 * px, backgroundColor: color }} />
      <View style={{ position: 'absolute', left: 3 * px, top: 0, width: 2 * px, height: size, backgroundColor: color }} />
    </View>
  );
}

const B = 4; // one "pixel" block of the frame

/**
 * A chunky 8-bit button face: flat fill, stepped corners (a block cut from each), a light
 * top edge and a dark bottom edge. Put it inside a Pressable.
 */
export function PixelBlock({
  color,
  children,
  style,
}: {
  color: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const Colors = useColors();
  const corner = { position: 'absolute', width: B, height: B, backgroundColor: Colors.background } as const;
  return (
    <View
      style={[
        { backgroundColor: color, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
        style,
      ]}>
      <View pointerEvents="none" style={{ position: 'absolute', left: B, right: B, top: 0, height: B, backgroundColor: 'rgba(255,255,255,0.22)' }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: B, right: B, bottom: 0, height: B, backgroundColor: 'rgba(0,0,0,0.3)' }} />
      {children}
      <View pointerEvents="none" style={[corner, { left: 0, top: 0 }]} />
      <View pointerEvents="none" style={[corner, { right: 0, top: 0 }]} />
      <View pointerEvents="none" style={[corner, { left: 0, bottom: 0 }]} />
      <View pointerEvents="none" style={[corner, { right: 0, bottom: 0 }]} />
    </View>
  );
}
