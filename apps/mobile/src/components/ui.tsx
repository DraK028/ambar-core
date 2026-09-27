import { formatMXN, splitAmount } from '@ambar/banking-rules';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { space, useTheme } from '@/lib/theme';

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const t = useTheme();
  const content = <View style={styles.content}>{children}</View>;
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.bg }]} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

export function Title({ children, focusable }: { children: ReactNode; focusable?: boolean }) {
  const t = useTheme();
  return (
    <Text accessibilityRole="header" accessible={focusable ?? true} style={[styles.title, { color: t.text }]}>
      {children}
    </Text>
  );
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  const t = useTheme();
  return <Text style={[styles.body, { color: muted ? t.muted : t.text }, style]}>{children}</Text>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.eyebrow, { color: t.muted }]}>{children}</Text>;
}

export function Card({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.line }]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  busy,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'quiet';
  busy?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.accentFill : kind === 'secondary' ? t.surface : 'transparent';
  const fg = kind === 'primary' ? t.onAccent : kind === 'quiet' ? t.accent : t.text;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: kind === 'secondary' ? t.line : bg, opacity: pressed || disabled ? 0.7 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, hint, error, ...input }: TextInputProps & { label: string; hint?: string; error?: string }) {
  const t = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: t.text }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        placeholderTextColor={t.muted}
        style={[styles.input, { color: t.text, backgroundColor: error ? t.dangerSoft : t.raised, borderColor: error ? t.danger : t.line }]}
        {...input}
      />
      {hint && !error ? <Text style={[styles.hint, { color: t.muted }]}>{hint}</Text> : null}
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: t.danger, fontWeight: '600' }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Monto con centavos reducidos; el lector de pantalla oye el monto completo. */
export function Amount({ centavos, size = 'md', signed }: { centavos: number; size?: 'md' | 'xl'; signed?: boolean }) {
  const t = useTheme();
  const { sign, pesos, cents } = splitAmount(centavos);
  const prefix = sign === '-' ? '−' : signed && centavos > 0 ? '+' : '';
  const big = size === 'xl' ? 40 : 18;
  const color = signed && centavos > 0 ? t.positive : t.text;
  return (
    <Text accessibilityLabel={`${prefix === '+' ? 'más ' : prefix === '−' ? 'menos ' : ''}${formatMXN(Math.abs(centavos))}`} style={{ color }}>
      <Text style={{ fontSize: big, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
        {prefix}${pesos}
      </Text>
      <Text style={{ fontSize: big * 0.55, fontWeight: '700' }}>.{cents}</Text>
    </Text>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' }) {
  const t = useTheme();
  return (
    <View
      accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      style={[styles.notice, { borderColor: tone === 'error' ? t.danger : t.line, backgroundColor: tone === 'error' ? t.dangerSoft : t.raised }]}
    >
      <Text style={{ color: t.text }}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flexGrow: 1 },
  content: { padding: space.lg, gap: space.lg },
  title: { fontSize: 26, fontWeight: '800', lineHeight: 32 },
  body: { fontSize: 16, lineHeight: 23 },
  eyebrow: { fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', fontWeight: '600' },
  card: { borderWidth: 1, borderRadius: 12, padding: space.lg, gap: space.sm },
  button: { minHeight: 50, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  buttonText: { fontSize: 16, fontWeight: '700' },
  field: { gap: space.xs },
  label: { fontSize: 15, fontWeight: '600' },
  input: { minHeight: 50, borderWidth: 1, borderRadius: 10, paddingHorizontal: space.md, fontSize: 17 },
  hint: { fontSize: 13 },
  notice: { borderWidth: 1, borderRadius: 10, padding: space.md },
});
