import { View } from 'react-native';

import { useColors } from '@/constants/theme';

// The check's pixels on a 10×10 grid (the same mark as 128bit Tracker's episode list).
const PIXELS: [number, number][] = [[2, 5], [3, 6], [4, 6], [4, 5], [5, 4], [6, 3], [7, 2]];

/** A pixel-art check box: an episode you've watched. */
export function PixelCheck({ size = 22 }: { size?: number }) {
  const Colors = useColors();
  const px = size / 10;
  return (
    <View
      accessibilityLabel="Watched"
      style={{ width: size, height: size, backgroundColor: Colors.accent, borderRadius: px * 0.6 }}>
      {PIXELS.map(([x, y]) => (
        <View
          key={`${x}:${y}`}
          style={{ position: 'absolute', left: x * px, top: y * px, width: Math.ceil(px), height: Math.ceil(px), backgroundColor: Colors.background }}
        />
      ))}
    </View>
  );
}
