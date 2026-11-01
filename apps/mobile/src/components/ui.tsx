import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { C, HEX, T } from '@/lib/theme';
import { appear, disappear, EASE, GLIDE } from '@/lib/motion';
import { initials } from '@/lib/format';
import { serverImage } from '@/lib/api';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Pressable that dims while pressed (like native iOS controls), used for every tappable surface. */
export function Tap({ style, children, haptic = 'selection', onPress, ...rest }: PressableProps & { style?: StyleProp<ViewStyle>; haptic?: 'selection' | 'light' | 'none'; children?: ReactNode }) {
  const opacity = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        opacity.set(withTiming(0.55, { duration: 60 }));
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        opacity.set(withTiming(1, { duration: 180, easing: EASE }));
        rest.onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic === 'selection') void Haptics.selectionAsync();
        if (haptic === 'light') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.(e);
      }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}

/** Liquid Glass on iOS 26+, a system material blur on older versions. */
export function Glass({ style, children, interactive, tint }: { style?: StyleProp<ViewStyle>; children?: ReactNode; interactive?: boolean; tint?: string }) {
  if (isLiquidGlassAvailable()) {
    return (
      <GlassView style={style} isInteractive={interactive} tintColor={tint}>
        {children}
      </GlassView>
    );
  }
  return (
    <BlurView intensity={90} tint="systemChromeMaterial" style={[style, { overflow: 'hidden', backgroundColor: tint }]}>
      {children}
    </BlurView>
  );
}

export function GlassButton({ icon, label, onPress, badge, size = 48, tintIcon }: { icon: SFSymbol; label: string; onPress: () => void; badge?: number; size?: number; tintIcon?: string }) {
  return (
    <Tap accessibilityLabel={label} accessibilityRole="button" onPress={onPress}>
      <Glass style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}>
        <SymbolView name={icon} size={size * 0.42} weight="medium" tintColor={tintIcon ?? C.label} />
      </Glass>
      {!!badge && (
        <View pointerEvents="none" style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      )}
    </Tap>
  );
}

export function GlassPill({ icon, label, onPress, accent, sub }: { icon: SFSymbol; label: string; onPress: () => void; accent?: boolean; sub?: string }) {
  return (
    <Tap accessibilityRole="button" accessibilityLabel={label} onPress={onPress} haptic="light">
      <Glass tint={accent ? 'rgba(255,107,61,0.85)' : undefined} style={styles.pill}>
        <SymbolView name={icon} size={18} weight="semibold" tintColor={accent ? 'white' : C.label} />
        <View>
          <Text style={[styles.pillText, accent && { color: 'white' }]}>{label}</Text>
          {sub && <Text style={[styles.pillSub, accent && { color: 'rgba(255,255,255,0.85)' }]}>{sub}</Text>}
        </View>
      </Glass>
    </Tap>
  );
}

/** Kept for older call sites. */
export const GlassIconButton = ({ icon, onPress, label }: { icon: SFSymbol; onPress: () => void; label: string; active?: boolean }) => <GlassButton icon={icon} label={label} onPress={onPress} size={44} />;

/**
 * Profile photo, or coloured initials when there is none (or while it loads).
 * Photos come from the Nodara server with the session token.
 */
export function Avatar({
  name,
  color,
  url,
  size = 40,
  dim,
  ring,
  border,
}: {
  name: string;
  color: string;
  url?: string | null;
  size?: number;
  dim?: boolean;
  ring?: boolean;
  /** Draw a white outline (for stacks and map markers). */
  border?: number;
}) {
  const src = serverImage(url);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: dim && !src ? HEX.gray : color,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderWidth: ring ? 3 : (border ?? 0),
        borderColor: ring ? C.accent : 'white',
        opacity: dim && src ? 0.55 : 1,
      }}
      accessibilityIgnoresInvertColors
    >
      <Text style={{ color: 'white', fontWeight: '700', fontSize: size * 0.38 }} allowFontScaling={false}>
        {initials(name)}
      </Text>
      {src && <Image source={src} style={StyleSheet.absoluteFill} contentFit="cover" transition={180} cachePolicy="memory-disk" recyclingKey={url ?? undefined} />}
    </View>
  );
}

/** Overlapping row of avatars: "who's here". */
export function AvatarStack({ people, size = 28, max = 4 }: { people: { id: string; displayName: string; avatarColor: string; avatarUrl?: string | null }[]; size?: number; max?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {people.slice(0, max).map((p, i) => (
        <View key={p.id} style={{ marginLeft: i ? -size * 0.3 : 0, zIndex: max - i }}>
          <Avatar name={p.displayName} color={p.avatarColor} url={p.avatarUrl} size={size} border={2} />
        </View>
      ))}
      {people.length > max && <Text style={{ marginLeft: 6, fontSize: 13, fontWeight: '700', color: C.secondaryLabel }}>+{people.length - max}</Text>}
    </View>
  );
}

/** Segmented control with a sliding selection pill. */
export function Segmented<K extends string>({
  value,
  onChange,
  items,
  style,
}: {
  value: K;
  onChange: (k: K) => void;
  items: { key: K; label: string; icon?: SFSymbol; count?: number }[];
  style?: StyleProp<ViewStyle>;
}) {
  const [width, setWidth] = useState(0);
  const i = Math.max(0, items.findIndex((s) => s.key === value));
  const seg = width / items.length;
  const pill = useAnimatedStyle(() => ({ width: seg - 4, transform: [{ translateX: withTiming(i * seg + 2, GLIDE) }] }), [i, seg]);
  return (
    <View style={[styles.segment, style]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityRole="tablist">
      {width > 0 && <Animated.View style={[styles.segmentPill, pill]} />}
      {items.map((s) => {
        const on = s.key === value;
        return (
          <Tap key={s.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(s.key)} style={styles.segmentItem}>
            {s.icon && <SymbolView name={s.icon} size={15} tintColor={on ? C.accent : C.secondaryLabel} />}
            <Text style={[styles.segmentText, on && { color: C.label }]}>{s.label}</Text>
            {!!s.count && <Text style={styles.segmentCount}>{s.count}</Text>}
          </Tap>
        );
      })}
    </View>
  );
}

/** Small dot that breathes while a location is live. */
export function LiveDot({ color = HEX.green, live, size = 10 }: { color?: string; live?: boolean; size?: number }) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.set(live ? withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1, false) : 0);
  }, [live, pulse]);
  const ring = useAnimatedStyle(() => ({ opacity: live ? 0.5 * (1 - pulse.value) : 0, transform: [{ scale: 1 + pulse.value * 1.6 }] }));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color }, ring]} />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

export function StatusPill({ icon, text, color }: { icon?: SFSymbol; text: string; color: string }) {
  return (
    <View style={[styles.statusPill, { backgroundColor: `${color}22` }]}>
      {icon && <SymbolView name={icon} size={11} weight="bold" tintColor={color} />}
      <Text style={[styles.statusText, { color }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

export function Skeleton({ height = 72, style }: { height?: number; style?: StyleProp<ViewStyle> }) {
  const o = useSharedValue(0.5);
  useEffect(() => {
    o.set(withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0.5, { duration: 700 })), -1));
  }, [o]);
  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ height, borderRadius: 24, backgroundColor: C.fill }, a, style]} />;
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
  iconColor = C.accent as string,
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
      {left ??
        (icon && (
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
            <Text style={styles.rowSubtitle} numberOfLines={3}>
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

export function PrimaryButton({ title, onPress, loading, disabled, icon, tone = 'accent' }: { title: string; onPress: () => void; loading?: boolean; disabled?: boolean; icon?: SFSymbol; tone?: 'accent' | 'plain' }) {
  const plain = tone === 'plain';
  return (
    <Tap disabled={disabled || loading} onPress={onPress} haptic="light" style={[styles.primary, plain && { backgroundColor: C.fill }, (disabled || loading) && { opacity: 0.5 }]}>
      {loading ? <ActivityIndicator color={plain ? undefined : 'white'} /> : icon ? <SymbolView name={icon} size={18} tintColor={plain ? C.accent : 'white'} /> : null}
      <Text style={[styles.primaryText, plain && { color: C.accent }]}>{title}</Text>
    </Tap>
  );
}

export function Empty({ icon, title, body, action }: { icon: SFSymbol; title: string; body?: string; action?: ReactNode }) {
  return (
    <Animated.View entering={appear} style={{ alignItems: 'center', paddingVertical: 36, paddingHorizontal: 28, gap: 8 }}>
      <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
        <SymbolView name={icon} size={36} tintColor={C.accent} type="hierarchical" />
      </View>
      <Text style={[T.title3, { color: C.label, textAlign: 'center' }]}>{title}</Text>
      {body && <Text style={[T.subhead, { color: C.secondaryLabel, textAlign: 'center', lineHeight: 21 }]}>{body}</Text>}
      {action && <View style={{ marginTop: 12, alignSelf: 'stretch' }}>{action}</View>}
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Toasts: short confirmations that slide in from the top instead of blocking alerts.

type ToastTone = 'success' | 'info' | 'error';
interface ToastMsg {
  id: number;
  title: string;
  body?: string;
  tone: ToastTone;
}
const ToastCtx = createContext<(t: Omit<ToastMsg, 'id'>) => void>(() => {});
export const useToast = () => use(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const insets = useSafeAreaInsets();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((t: Omit<ToastMsg, 'id'>) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ ...t, id: Date.now() });
    void Haptics.notificationAsync(t.tone === 'error' ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Success);
    timer.current = setTimeout(() => setToast(null), t.tone === 'error' ? 5000 : 3200);
  }, []);
  const icon: Record<ToastTone, SFSymbol> = { success: 'checkmark.circle.fill', info: 'info.circle.fill', error: 'exclamationmark.triangle.fill' };
  const color: Record<ToastTone, string> = { success: HEX.green, info: HEX.blue, error: HEX.red };
  return (
    <ToastCtx value={show}>
      {children}
      {toast && (
        <Animated.View key={toast.id} entering={appear} exiting={disappear} style={[styles.toastWrap, { top: insets.top + 8 }]} pointerEvents="box-none">
          <Pressable onPress={() => setToast(null)}>
            <Glass style={styles.toast}>
              <SymbolView name={icon[toast.tone]} size={24} tintColor={color[toast.tone]} />
              <View style={{ flex: 1 }}>
                <Text style={[T.headline, { color: C.label }]}>{toast.title}</Text>
                {toast.body && <Text style={[T.footnote, { color: C.secondaryLabel, marginTop: 1 }]}>{toast.body}</Text>}
              </View>
            </Glass>
          </Pressable>
        </Animated.View>
      )}
    </ToastCtx>
  );
}

export const styles = StyleSheet.create({
  badge: { position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'white' },
  badgeText: { color: 'white', fontSize: 11, fontWeight: '800' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 48, paddingHorizontal: 18, borderRadius: 24 },
  pillText: { fontSize: 16, fontWeight: '700', color: C.label },
  pillSub: { fontSize: 11, color: C.secondaryLabel, marginTop: -1 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 22, borderRadius: 11, alignSelf: 'flex-start' },
  statusText: { fontSize: 12, fontWeight: '700' },
  sectionTitle: { fontSize: 13, color: C.secondaryLabel, marginHorizontal: 20, marginBottom: 6 },
  sectionFooter: { fontSize: 13, color: C.secondaryLabel, marginHorizontal: 20, marginTop: 6, lineHeight: 18 },
  section: { backgroundColor: C.cell, borderRadius: 26, borderCurve: 'continuous', marginHorizontal: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, minHeight: 52 },
  rowIcon: { width: 30, height: 30, borderRadius: 8, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingRight: 16, minHeight: 52 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.separator },
  rowTitle: { fontSize: 17, color: C.label },
  rowSubtitle: { fontSize: 14, color: C.secondaryLabel, marginTop: 2, lineHeight: 19 },
  rowValue: { fontSize: 16, color: C.secondaryLabel },
  primary: { height: 54, borderRadius: 27, backgroundColor: C.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { color: 'white', fontSize: 17, fontWeight: '600' },
  input: { fontSize: 17, color: C.label, paddingHorizontal: 16, paddingVertical: 15 },
  segment: { flexDirection: 'row', height: 40, borderRadius: 20, backgroundColor: C.fill, padding: 2 },
  segmentPill: { position: 'absolute', top: 2, bottom: 2, borderRadius: 18, backgroundColor: C.cell, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  segmentItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  segmentText: { fontSize: 14, fontWeight: '600', color: C.secondaryLabel },
  segmentCount: { fontSize: 12, fontWeight: '700', color: C.tertiaryLabel },
  toastWrap: { position: 'absolute', left: 12, right: 12, zIndex: 100 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 24 },
});
