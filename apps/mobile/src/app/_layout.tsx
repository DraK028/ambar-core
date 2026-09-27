import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initializeSslPinning } from 'react-native-ssl-public-key-pinning';
import { PrivacyShield } from '@/components/PrivacyShield';
import { config } from '@/lib/config';
import { SessionProvider, useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

// Certificate pinning: solo con dominio propio. Se fijan dos llaves (principal y respaldo)
// para que una rotación de certificado no deje la app sin conexión.
const pins = config.pinHashes?.split(',').map((h) => h.trim()).filter(Boolean) ?? [];
if (config.pinnedDomain && pins.length >= 2) {
  void initializeSslPinning({ [config.pinnedDomain]: { includeSubdomains: false, publicKeyHashes: pins } });
} else if (config.pinnedDomain) {
  console.warn('Pinning desactivado: EXPO_PUBLIC_PIN_HASHES necesita al menos dos hashes.');
}

/** Cada cambio de estado de la sesión vuelve a la raíz, que decide la pantalla correcta. */
function SessionRouter() {
  const { status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status !== 'loading') router.replace('/');
  }, [status, router]);
  return null;
}

export default function RootLayout() {
  const t = useTheme();
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <SessionRouter />
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />
        <PrivacyShield />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
