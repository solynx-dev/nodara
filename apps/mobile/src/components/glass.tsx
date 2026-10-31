import { type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Button, Divider, Host, Menu } from '@expo/ui/swift-ui';
import { buttonBorderShape, buttonStyle, controlSize, labelStyle, tint } from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'expo-symbols';
import { GlassIconButton } from './ui';
import { C } from '@/lib/theme';

/** Real SwiftUI Liquid Glass buttons on iOS 26+, bordered system buttons on older iOS. */
const glass = () => buttonStyle(isLiquidGlassAvailable() ? 'glass' : 'bordered');
const prominent = () => buttonStyle(isLiquidGlassAvailable() ? 'glassProminent' : 'borderedProminent');

export function GlassCircleButton({ icon, label, onPress, badge }: { icon: SFSymbol; label: string; onPress: () => void; badge?: number }) {
  const button =
    Platform.OS === 'ios' ? (
      <Host matchContents>
        <Button
          systemImage={icon}
          label={label}
          onPress={onPress}
          modifiers={[labelStyle('iconOnly'), glass(), buttonBorderShape('circle'), controlSize('extraLarge'), tint(C.label as string)]}
        />
      </Host>
    ) : (
      <GlassIconButton icon={icon} label={label} onPress={onPress} />
    );
  if (!badge) return button;
  return (
    <View>
      {button}
      <View pointerEvents="none" style={styles.badge}>
        <View style={styles.badgeDot}>
          <BadgeText n={badge} />
        </View>
      </View>
    </View>
  );
}

function BadgeText({ n }: { n: number }) {
  return <Text style={{ color: 'white', fontSize: 12, fontWeight: '700' }}>{n > 99 ? '99+' : n}</Text>;
}

export function GlassPillButton({ icon, label, onPress, accent }: { icon: SFSymbol; label: string; onPress: () => void; accent?: boolean }) {
  if (Platform.OS !== 'ios') return <GlassIconButton icon={icon} label={label} onPress={onPress} />;
  return (
    <Host matchContents>
      <Button
        systemImage={icon}
        label={label}
        onPress={onPress}
        modifiers={[labelStyle('titleAndIcon'), accent ? prominent() : glass(), buttonBorderShape('capsule'), controlSize('large'), tint(accent ? C.accent : (C.label as string))]}
      />
    </Host>
  );
}

export interface MenuOption {
  key: string;
  label: string;
  icon?: SFSymbol;
  checked?: boolean;
  destructive?: boolean;
  dividerBefore?: boolean;
  onPress: () => void;
}

/** Native pull-down menu shown from a Liquid Glass capsule. */
export function GlassMenu({ label, icon, options, iconOnly, children }: { label: string; icon?: SFSymbol; options: MenuOption[]; iconOnly?: boolean; children?: ReactNode }) {
  if (Platform.OS !== 'ios') return <>{children}</>;
  return (
    <Host matchContents>
      <Menu
        label={label}
        systemImage={icon}
        modifiers={[...(iconOnly ? [labelStyle('iconOnly')] : []), glass(), buttonBorderShape(iconOnly ? 'circle' : 'capsule'), controlSize('extraLarge'), tint(C.label as string)]}
      >
        {options.flatMap((o) => [
          ...(o.dividerBefore ? [<Divider key={`${o.key}-div`} />] : []),
          <Button key={o.key} label={o.label} systemImage={o.checked ? 'checkmark' : o.icon} role={o.destructive ? 'destructive' : 'default'} onPress={o.onPress} />,
        ])}
      </Menu>
    </Host>
  );
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', top: -4, right: -4 },
  badgeDot: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'white' },
});
