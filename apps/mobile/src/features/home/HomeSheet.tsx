import { type ReactNode } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { BottomSheet, Group, Host, RNHostView } from '@expo/ui/swift-ui';
import {
  interactiveDismissDisabled,
  presentationBackgroundInteraction,
  presentationDetents,
  presentationDragIndicator,
  type PresentationDetent,
} from '@expo/ui/swift-ui/modifiers';
import { Glass } from '@/components/ui';

export const PEEK: PresentationDetent = { height: 220 };
export const HALF: PresentationDetent = { fraction: 0.46 };
export const DETENTS: PresentationDetent[] = [PEEK, HALF, 'large'];

export function detentHeight(d: PresentationDetent, screen: number) {
  if (d === 'large') return screen;
  if (d === 'medium') return screen * 0.5;
  return 'height' in d ? d.height : d.fraction * screen;
}

/**
 * The persistent, always-present sheet over the map (like Find My). It's a
 * native SwiftUI sheet, so on iOS 26 it gets the system Liquid Glass material
 * and behaviour for free; the map stays interactive behind its lower detents.
 */
export function HomeSheet({
  visible,
  detent,
  onDetentChange,
  children,
}: {
  visible: boolean;
  detent: PresentationDetent;
  onDetentChange: (d: PresentationDetent) => void;
  children: ReactNode;
}) {
  const { height } = useWindowDimensions();
  if (Platform.OS !== 'ios') {
    // Fallback for non-iOS: a fixed glass panel.
    return (
      <Glass style={[styles.fallback, { height: detentHeight(detent, height) }]}>
        <View style={{ flex: 1 }}>{children}</View>
      </Glass>
    );
  }
  return (
    <Host style={styles.host}>
      <BottomSheet isPresented={visible} onIsPresentedChange={() => {}}>
        <Group
          modifiers={[
            presentationDetents(DETENTS, { selection: detent, onSelectionChange: onDetentChange }),
            presentationDragIndicator('visible'),
            // Keep the map usable while the sheet is small or half height.
            presentationBackgroundInteraction({ type: 'enabledUpThrough', detent: HALF }),
            interactiveDismissDisabled(),
          ]}
        >
          <RNHostView>
            <View style={{ flex: 1 }}>{children}</View>
          </RNHostView>
        </Group>
      </BottomSheet>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, bottom: 0, width: 1, height: 1 },
  fallback: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
});
