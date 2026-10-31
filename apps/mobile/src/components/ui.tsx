import { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { C } from '@/lib/theme';
import { initials } from '@/lib/format';

export function Avatar({ name, color, size = 40, dim, ring }: { name: string; color: string; size?: number; dim?: boolean; ring?: boolean }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: dim ? 0.5 : 1,
        borderWidth: ring ? 3 : 0,
        borderColor: C.accent,
        borderCurve: 'continuous',
      }}
    >
      <Text style={{ color: 'white', fontWeight: '700', fontSize: size * 0.38 }}>{initials(name)}</Text>
    </View>
  );
}

/** Liquid Glass on iOS 26+, a system blur material on older versions. */
export function Glass({ style, children, interactive }: { style?: StyleProp<ViewStyle>; children?: ReactNode; interactive?: boolean }) {
  if (isLiquidGlassAvailable()) {
    return (
      <GlassView style={style} isInteractive={interactive}>
        {children}
      </GlassView>
    );
  }
  return (
    <BlurView intensity={80} tint="systemChromeMaterial" style={[style, { overflow: 'hidden' }]}>
      {children}
    </BlurView>
  );
}

export function GlassIconButton({ icon, onPress, label, active }: { icon: SFSymbol; onPress: () => void; label: string; active?: boolean }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
    >
      <Glass interactive style={styles.glassButton}>
        <SymbolView name={icon} size={20} tintColor={active ? C.accent : C.label} />
      </Glass>
    </Pressable>
  );
}

/** iOS Settings-style grouped section. */
export function Section({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ marginBottom: 28 }}>
      {title && <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>}
      <View style={styles.section}>{children}</View>
      {footer && <Text style={styles.sectionFooter}>{footer}</Text>}
    </View>
  );
}

export function Row({
  icon,
  iconColor = C.accent,
  title,
  subtitle,
  value,
  onPress,
  accessory,
  left,
  last,
  destructive,
}: {
  icon?: SFSymbol;
  iconColor?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  onPress?: () => void;
  accessory?: ReactNode;
  left?: ReactNode;
  last?: boolean;
  destructive?: boolean;
}) {
  const content = (
    <View style={styles.row}>
      {left ?? (icon && (
        <View style={[styles.rowIcon, { backgroundColor: iconColor }]}>
          <SymbolView name={icon} size={16} tintColor="white" />
        </View>
      ))}
      <View style={[styles.rowBody, !last && styles.rowDivider]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, destructive && { color: C.red }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle != null && (
            <Text style={styles.rowSubtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          )}
        </View>
        {value != null && <Text style={styles.rowValue}>{value}</Text>}
        {accessory ?? (onPress && <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={C.tertiaryLabel} />)}
      </View>
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { backgroundColor: C.fill }}>
      {content}
    </Pressable>
  );
}

export function PrimaryButton({ title, onPress, loading, disabled, icon }: { title: string; onPress: () => void; loading?: boolean; disabled?: boolean; icon?: SFSymbol }) {
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [styles.primary, (disabled || loading) && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.98 }] }]}
    >
      {loading ? <ActivityIndicator color="white" /> : icon ? <SymbolView name={icon} size={18} tintColor="white" /> : null}
      <Text style={styles.primaryText}>{title}</Text>
    </Pressable>
  );
}

export function Empty({ icon, title, body, action }: { icon: SFSymbol; title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32, gap: 8 }}>
      <SymbolView name={icon} size={44} tintColor={C.accent} type="hierarchical" />
      <Text style={{ fontSize: 20, fontWeight: '700', color: C.label, marginTop: 8, textAlign: 'center' }}>{title}</Text>
      {body && <Text style={{ fontSize: 15, color: C.secondaryLabel, textAlign: 'center', lineHeight: 21 }}>{body}</Text>}
      {action && <View style={{ marginTop: 12, alignSelf: 'stretch' }}>{action}</View>}
    </View>
  );
}

export const styles = StyleSheet.create({
  glassButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 13, color: C.secondaryLabel, marginHorizontal: 20, marginBottom: 6 },
  sectionFooter: { fontSize: 13, color: C.secondaryLabel, marginHorizontal: 20, marginTop: 6, lineHeight: 18 },
  section: { backgroundColor: C.cell, borderRadius: 26, borderCurve: 'continuous', marginHorizontal: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, minHeight: 52 },
  rowIcon: { width: 30, height: 30, borderRadius: 8, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingRight: 16, minHeight: 52 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.separator },
  rowTitle: { fontSize: 17, color: C.label },
  rowSubtitle: { fontSize: 14, color: C.secondaryLabel, marginTop: 2 },
  rowValue: { fontSize: 16, color: C.secondaryLabel },
  primary: { height: 54, borderRadius: 27, backgroundColor: C.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { color: 'white', fontSize: 17, fontWeight: '600' },
  input: { fontSize: 17, color: C.label, paddingHorizontal: 16, paddingVertical: 15 },
});
