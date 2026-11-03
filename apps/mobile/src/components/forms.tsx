import { forwardRef, type ReactNode } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';
import Animated from 'react-native-reanimated';
import { SymbolView } from 'expo-symbols';
import { appear } from '@/lib/motion';
import { C, T } from '@/lib/theme';
import { styles as ui } from './ui';

/** A grouped block of text fields, like iOS Settings. */
export function FieldGroup({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ marginBottom: 24 }}>
      {title && <Text style={ui.sectionTitle}>{title.toUpperCase()}</Text>}
      <View style={ui.section}>{children}</View>
      {footer != null && <Text style={ui.sectionFooter}>{footer}</Text>}
    </View>
  );
}

/** One text field inside a FieldGroup. */
export const Field = forwardRef<TextInputInstance, TextInputProps & { last?: boolean }>(function Field({ last, style, ...props }, ref) {
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={C.tertiaryLabel as string}
      style={[ui.input, !last && styles.divider, style]}
      autoCorrect={false}
      {...props}
    />
  );
});

/** Six-digit code from an email or authenticator app. Calls onComplete once all digits are in. */
export function CodeInput({ value, onChange, onComplete, autoFocus = true }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; autoFocus?: boolean }) {
  return (
    <View style={[ui.section, { marginBottom: 12 }]}>
      <TextInput
        value={value}
        onChangeText={(t) => {
          const digits = t.replace(/\D/g, '').slice(0, 6);
          onChange(digits);
          if (digits.length === 6 && digits !== value) onComplete?.(digits);
        }}
        placeholder="000000"
        placeholderTextColor={C.tertiaryLabel as string}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        maxLength={7}
        style={styles.code}
        accessibilityLabel="Six-digit code"
      />
    </View>
  );
}

export function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <Animated.View entering={appear} style={styles.error}>
      <SymbolView name="exclamationmark.circle.fill" size={16} tintColor={C.red} />
      <Text style={[T.footnote, { color: C.red, flex: 1 }]}>{error}</Text>
    </Animated.View>
  );
}

/** Big icon + title + text at the top of a focused task screen. */
export function FormHeader({ icon, title, body, color = C.accent as string }: { icon: Parameters<typeof SymbolView>[0]['name']; title: string; body?: ReactNode; color?: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingHorizontal: 28, paddingTop: 8, paddingBottom: 24 }}>
      <View style={[styles.headerIcon, { backgroundColor: `${color}1F` }]}>
        <SymbolView name={icon} size={34} tintColor={color} type="hierarchical" />
      </View>
      <Text style={[T.title2, { color: C.label, textAlign: 'center' }]}>{title}</Text>
      {body != null && <Text style={[T.subhead, { color: C.secondaryLabel, textAlign: 'center', lineHeight: 21 }]}>{body}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.separator },
  code: { fontSize: 32, fontWeight: '700', letterSpacing: 12, textAlign: 'center', color: C.label, paddingVertical: 16, fontVariant: ['tabular-nums'] },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginBottom: 16 },
  headerIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
});
