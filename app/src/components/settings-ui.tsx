import Ionicons from '@expo/vector-icons/Ionicons';
import { Children, Fragment, type ComponentProps, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Radius, Spacing, makeStyles, useColors } from '@/constants/theme';
import { Pressable } from '@/components/focusable';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Scrollable page with an optional large title, like the rest of Settings. */
export function SettingsPage({ title, children }: { title?: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
      {title ? <Text style={styles.bigTitle}>{title}</Text> : null}
      {children}
    </ScrollView>
  );
}

export function SectionTitle({ children }: { children: string }) {
  const styles = useStyles();
  return <Text style={styles.section}>{children.toUpperCase()}</Text>;
}

/** Rounded card holding rows, with hairlines between them. */
export function Group({ children }: { children: ReactNode }) {
  const styles = useStyles();
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.group}>
      {items.map((child, i) => (
        <Fragment key={i}>
          {i > 0 ? <View style={styles.divider} /> : null}
          {child}
        </Fragment>
      ))}
    </View>
  );
}

type RowProps = {
  icon?: IconName;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  right?: ReactNode;
  danger?: boolean;
};

export function Row({ icon, title, subtitle, value, onPress, right, danger }: RowProps) {
  const Colors = useColors();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
      {icon ? (
        <View style={styles.iconBox}>
          <Ionicons name={icon} size={22} color={danger ? Colors.danger : Colors.text} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.rowTitle, danger && { color: Colors.danger }]}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={styles.value}>{value}</Text> : null}
      {right}
    </Pressable>
  );
}

export function ToggleRow({
  title,
  subtitle,
  value,
  onChange,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Row
      title={title}
      subtitle={subtitle}
      onPress={() => onChange(!value)}
      right={<ThemedSwitch value={value} onValueChange={onChange} />}
    />
  );
}

/** Tapping cycles through the options; the current one is shown on the right. */
export function ChoiceRow<T extends string | number>({
  title,
  subtitle,
  value,
  options,
  onChange,
}: {
  title: string;
  subtitle?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <Row
      title={title}
      subtitle={subtitle}
      value={options[index]?.label}
      onPress={() => onChange(options[(index + 1) % options.length].value)}
    />
  );
}

/** A switch in the accent colour with a white thumb on every platform. */
export function ThemedSwitch({
  value,
  onValueChange,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  const Colors = useColors();
  // react-native-web colours the "on" thumb with its own prop.
  const webThumb = { activeThumbColor: '#fff' } as object;
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      trackColor={{ true: Colors.accent, false: Colors.border }}
      thumbColor="#fff"
      {...webThumb}
    />
  );
}

export function Chip({ label }: { label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((Colors) => ({
  page: { flex: 1, backgroundColor: Colors.background },
  pageContent: {
    padding: Spacing.three,
    paddingBottom: Spacing.five * 2,
    gap: Spacing.two,
  },
  bigTitle: {
    color: Colors.text,
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: -1,
    marginTop: Spacing.four,
  },
  section: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: Spacing.three,
    marginBottom: Spacing.one,
  },
  group: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginLeft: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    minHeight: 64,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { color: Colors.text, fontSize: 17, fontWeight: '500' },
  rowSub: { color: Colors.textSecondary, fontSize: 14, lineHeight: 19 },
  value: { color: Colors.text, fontSize: 15, fontWeight: '500' },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceRaised,
  },
  chipText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
}));
