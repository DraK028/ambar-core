import { useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/lib/theme';

/**
 * Cubre la pantalla cuando la app deja de estar activa: el selector de apps de iOS y Android
 * guarda una captura que, sin esto, mostraría saldos y CLABEs.
 */
export function PrivacyShield() {
  const t = useTheme();
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const s = AppState.addEventListener('change', (state) => setHidden(state !== 'active'));
    return () => s.remove();
  }, []);
  if (!hidden) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.shield, { backgroundColor: t.surface }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={[styles.brand, { color: t.text }]}>
        Ámbar<Text style={{ color: t.accentFill }}>.</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shield: { alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  brand: { fontSize: 34, fontWeight: '800' },
});
