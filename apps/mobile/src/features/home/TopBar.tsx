import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, ZoomIn, ZoomOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useMe } from '@/lib/session';
import { C, HEX, T } from '@/lib/theme';
import type { Circle } from '@/lib/types';
import { trackingStatus } from '@/background/tracking';
import { Glass, GlassButton, Tap } from '@/components/ui';

export function TopBar({
  circles,
  circleId,
  unread,
  onSettings,
  onAlerts,
  onSelectCircle,
  onNewCircle,
  onInvite,
  onFixSharing,
}: {
  circles: Circle[];
  circleId: string | null;
  unread: number;
  onSettings: () => void;
  onAlerts: () => void;
  onSelectCircle: (id: string | null) => void;
  onNewCircle: () => void;
  onInvite: () => void;
  onFixSharing: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const circle = circles.find((c) => c.id === circleId);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    setTimeout(fn, 180);
  };

  return (
    <View style={[styles.wrap, { top: insets.top + 6 }]} pointerEvents="box-none">
      <View style={styles.row} pointerEvents="box-none">
        <GlassButton icon="gearshape.fill" label="Settings" onPress={onSettings} />
        <Tap onPress={() => setOpen(true)} style={{ flex: 1 }} accessibilityRole="button" accessibilityLabel={`Circle: ${circle?.name ?? 'All circles'}. Switch circle`}>
          <Glass interactive style={styles.switcher}>
            <View style={[styles.circleDot, { backgroundColor: circle?.color ?? C.accent }]}>
              <SymbolView name="person.2.fill" size={12} tintColor="white" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[T.headline, { color: C.label }]} numberOfLines={1}>
                {circle?.name ?? 'All circles'}
              </Text>
              <Text style={[T.caption, { color: C.secondaryLabel, fontWeight: '500' }]} numberOfLines={1}>
                {circle ? `${circle.memberCount} ${circle.memberCount === 1 ? 'member' : 'members'}` : `${circles.length} ${circles.length === 1 ? 'circle' : 'circles'}`}
              </Text>
            </View>
            <SymbolView name="chevron.down" size={13} weight="bold" tintColor={C.secondaryLabel} />
          </Glass>
        </Tap>
        <GlassButton icon="bell.fill" label={unread ? `Alerts, ${unread} unread` : 'Alerts'} badge={unread} onPress={onAlerts} />
      </View>
      <SharingBanner onPress={onFixSharing} />

      <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} style={StyleSheet.absoluteFill}>
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.18)' }]} onPress={() => setOpen(false)} accessibilityLabel="Close circle menu" />
        </Animated.View>
        <Animated.View entering={ZoomIn.springify().damping(18).stiffness(260)} exiting={ZoomOut.duration(140)} style={[styles.menu, { top: insets.top + 62 }]}>
          <Glass style={styles.menuInner}>
            <Text style={styles.menuTitle}>Your circles</Text>
            <MenuItem icon="globe" color={HEX.gray} label="All circles" sub="Everyone you share with" checked={!circleId} onPress={pick(() => onSelectCircle(null))} />
            {circles.map((c) => (
              <MenuItem
                key={c.id}
                icon="person.2.fill"
                color={c.color}
                label={c.name}
                sub={`${c.memberCount} ${c.memberCount === 1 ? 'member' : 'members'}${c.sharing ? '' : ' · you’re not sharing'}`}
                checked={c.id === circleId}
                onPress={pick(() => onSelectCircle(c.id))}
              />
            ))}
            <View style={styles.divider} />
            <MenuItem icon="person.badge.plus" color={C.accent} label="Invite someone" onPress={pick(onInvite)} />
            {circleId && <MenuItem icon="gearshape.fill" color={HEX.gray} label="Manage this circle" sub="Members, roles, what people can see" onPress={pick(() => router.push(`/circle/${circleId}`))} />}
            <MenuItem icon="plus.circle.fill" color={HEX.blue} label="New circle" onPress={pick(onNewCircle)} />
          </Glass>
        </Animated.View>
      </Modal>
    </View>
  );
}

function MenuItem({ icon, color, label, sub, checked, onPress }: { icon: SFSymbol; color: string; label: string; sub?: string; checked?: boolean; onPress: () => void }) {
  return (
    <Tap onPress={onPress} style={styles.menuItem} scaleTo={0.98} accessibilityRole="menuitem" accessibilityState={{ selected: checked }}>
      <View style={[styles.menuIcon, { backgroundColor: color }]}>
        <SymbolView name={icon} size={14} tintColor="white" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[T.body, { color: C.label, fontWeight: checked ? '700' : '500' }]} numberOfLines={1}>
          {label}
        </Text>
        {sub && <Text style={[T.footnote, { color: C.secondaryLabel }]}>{sub}</Text>}
      </View>
      {checked && <SymbolView name="checkmark" size={16} weight="bold" tintColor={C.accent} />}
    </Tap>
  );
}

/** Shows up only when this phone isn't fully sharing — the most important thing to know in a location app. */
function SharingBanner({ onPress }: { onPress: () => void }) {
  const me = useMe();
  const { data: t } = useQuery({ queryKey: ['tracking'], queryFn: trackingStatus, refetchInterval: 20_000 });
  if (!t) return null;
  let banner: { icon: SFSymbol; color: string; title: string; sub: string } | null = null;
  if (me.sharingPaused) banner = { icon: 'pause.circle.fill', color: HEX.orange, title: 'Location paused', sub: 'Nobody can see where you are. Tap to resume.' };
  else if (!t.running) banner = { icon: 'location.slash.fill', color: HEX.red, title: 'Not sharing from this iPhone', sub: 'Tap to start sharing with your circles.' };
  else if (t.background !== 'granted') banner = { icon: 'exclamationmark.triangle.fill', color: HEX.orange, title: 'Only sharing while Nodara is open', sub: 'Allow “Always” so your circle sees you in the background.' };
  if (!banner) return null;
  return (
    <Animated.View entering={FadeInDown.springify()} exiting={FadeOut} style={{ marginTop: 10 }}>
      <Tap onPress={onPress} haptic="light" accessibilityRole="button" accessibilityLabel={`${banner.title}. ${banner.sub}`}>
        <Glass interactive style={styles.banner}>
          <SymbolView name={banner.icon} size={22} tintColor={banner.color} />
          <View style={{ flex: 1 }}>
            <Text style={[T.subhead, { color: C.label, fontWeight: '700' }]}>{banner.title}</Text>
            <Text style={[T.footnote, { color: C.secondaryLabel }]}>{banner.sub}</Text>
          </View>
          <SymbolView name="chevron.right" size={12} weight="bold" tintColor={C.tertiaryLabel} />
        </Glass>
      </Tap>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 14, right: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  switcher: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, paddingLeft: 10, paddingRight: 16, borderRadius: 26 },
  circleDot: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 22 },
  menu: { position: 'absolute', left: 16, right: 16, transformOrigin: 'top center' },
  menuInner: { borderRadius: 28, padding: 8 },
  menuTitle: { fontSize: 13, fontWeight: '700', color: C.secondaryLabel, textTransform: 'uppercase', marginLeft: 12, marginTop: 8, marginBottom: 4 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 18 },
  menuIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: C.separator, marginVertical: 6, marginHorizontal: 10 },
});
