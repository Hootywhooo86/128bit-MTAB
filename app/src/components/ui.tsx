import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';

import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { useCover } from '@/lib/covers';

export function Title({ style, ...rest }: TextProps) {
  const styles = useStyles();
  return <Text style={[styles.title, style]} {...rest} />;
}

export function Heading({ style, ...rest }: TextProps) {
  const styles = useStyles();
  return <Text style={[styles.heading, style]} {...rest} />;
}

export function Body({ style, muted, ...rest }: TextProps & { muted?: boolean }) {
  const styles = useStyles();
  return <Text style={[styles.body, muted && styles.muted, style]} {...rest} />;
}

type ButtonProps = PressableProps & {
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  label,
  variant = 'primary',
  loading,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const Colors = useColors();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        (pressed || disabled) && { opacity: 0.6 },
        style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? Colors.accentText : Colors.text} />
      ) : (
        <Text
          style={[
            styles.buttonLabel,
            variant === 'primary' && { color: Colors.accentText },
            variant === 'danger' && { color: Colors.danger },
          ]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Input(props: TextInputProps) {
  const Colors = useColors();
  const styles = useStyles();
  return (
    <TextInput
      placeholderTextColor={Colors.textSecondary}
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
      style={[styles.input, props.style]}
    />
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Square cover. Give `title` (and `author`) to look one up when `uri` is missing. */
export function Cover({
  uri,
  size = 120,
  title,
  author,
}: {
  uri?: string;
  size?: number;
  title?: string;
  author?: string;
}) {
  const styles = useStyles();
  uri = useCover(uri, title, author);
  return (
    <View style={[styles.cover, { width: size, height: size }]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
        />
      ) : (
        <Text style={styles.coverFallback}>128</Text>
      )}
    </View>
  );
}

export function EmptyState({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.empty}>
      <Heading style={{ textAlign: 'center' }}>{title}</Heading>
      {body ? (
        <Body muted style={{ textAlign: 'center' }}>
          {body}
        </Body>
      ) : null}
      {children}
    </View>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const styles = useStyles();
  return (
    <View style={styles.progressTrack}>
      <View
        style={[
          styles.progressFill,
          { width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` },
        ]}
      />
    </View>
  );
}

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

export function formatBytes(bytes?: number) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(i ? 1 : 0)} ${units[i]}`;
}

const useStyles = makeStyles((Colors) => ({
  title: {
    color: Colors.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  heading: { color: Colors.text, fontSize: 18, fontWeight: '700' },
  body: { color: Colors.text, fontSize: 15, lineHeight: 22 },
  muted: { color: Colors.textSecondary },
  button: {
    minHeight: 46,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: { backgroundColor: Colors.accent },
  buttonSecondary: {
    backgroundColor: Colors.surfaceRaised,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  buttonDanger: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.danger,
  },
  buttonLabel: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  input: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.md,
    color: Colors.text,
    paddingHorizontal: Spacing.three,
    minHeight: 46,
    fontSize: 15,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cover: {
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceRaised,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverFallback: {
    color: Colors.accent,
    fontWeight: '900',
    fontSize: 20,
    letterSpacing: 1,
  },
  empty: { alignItems: 'center', gap: Spacing.two, padding: Spacing.five },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.surfaceRaised,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: Colors.accent },
}));
