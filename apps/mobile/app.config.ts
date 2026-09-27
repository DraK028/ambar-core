import type { ExpoConfig } from 'expo/config';

/**
 * Configuración por entorno con variables EXPO_PUBLIC_* (se incrustan en el bundle:
 * nunca pongas secretos aquí). Ver .env.example.
 */
const env = process.env;

const config: ExpoConfig = {
  name: 'Ámbar',
  slug: 'ambar',
  version: '0.1.0',
  scheme: 'ambar',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'mx.ambar.banca',
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: 'mx.ambar.banca',
    // Sin respaldo en la nube: tokens y llaves no deben restaurarse en otro teléfono.
    allowBackup: false,
    adaptiveIcon: {
      backgroundColor: '#161D20',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['android.permission.USE_BIOMETRIC'],
  },
  plugins: [
    'expo-router',
    [
      'expo-secure-store',
      {
        faceIDPermission: 'Ámbar usa Face ID para desbloquear la app y confirmar transferencias.',
        configureAndroidBackup: true,
      },
    ],
    [
      'expo-local-authentication',
      { faceIDPermission: 'Ámbar usa Face ID para desbloquear la app y confirmar transferencias.' },
    ],
    // Avisos push (Expo Push → APNs/FCM). En Android crea el permiso POST_NOTIFICATIONS.
    ['expo-notifications', { color: '#161D20' }],
  ],
  experiments: { typedRoutes: true },
  extra: {
    apiUrl: env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
    assistantUrl: env.EXPO_PUBLIC_ASSISTANT_URL ?? env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
    authMode: env.EXPO_PUBLIC_AUTH_MODE ?? 'local',
    devAuthUrl: env.EXPO_PUBLIC_DEV_AUTH_URL ?? 'http://localhost:8787',
    cognitoDomain: env.EXPO_PUBLIC_COGNITO_DOMAIN,
    cognitoClientId: env.EXPO_PUBLIC_COGNITO_CLIENT_ID,
    pinnedDomain: env.EXPO_PUBLIC_PINNED_DOMAIN,
    pinHashes: env.EXPO_PUBLIC_PIN_HASHES,
    easProjectId: env.EXPO_PUBLIC_EAS_PROJECT_ID,
    ...(env.EXPO_PUBLIC_EAS_PROJECT_ID ? { eas: { projectId: env.EXPO_PUBLIC_EAS_PROJECT_ID } } : {}),
  },
};

export default config;
