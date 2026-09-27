import Constants from 'expo-constants';

interface Extra {
  apiUrl: string;
  /** Base del asistente; en AWS es la misma de la API (API Gateway enruta /v1/assistant). */
  assistantUrl: string;
  authMode: 'local' | 'cognito';
  devAuthUrl: string;
  cognitoDomain?: string;
  cognitoClientId?: string;
  pinnedDomain?: string;
  pinHashes?: string;
  /** Proyecto de EAS: lo exige Expo para emitir tokens push. Sin él, la app funciona sin push. */
  easProjectId?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Partial<Extra>;

export const config: Extra = {
  apiUrl: (extra.apiUrl ?? 'http://localhost:3000').replace(/\/$/, ''),
  assistantUrl: (extra.assistantUrl ?? extra.apiUrl ?? 'http://localhost:3000').replace(/\/$/, ''),
  authMode: extra.authMode === 'cognito' ? 'cognito' : 'local',
  devAuthUrl: (extra.devAuthUrl ?? 'http://localhost:8787').replace(/\/$/, ''),
  cognitoDomain: extra.cognitoDomain,
  cognitoClientId: extra.cognitoClientId,
  pinnedDomain: extra.pinnedDomain,
  pinHashes: extra.pinHashes,
  easProjectId: extra.easProjectId,
};

if (config.authMode === 'cognito' && (!config.cognitoDomain || !config.cognitoClientId)) {
  throw new Error('Con EXPO_PUBLIC_AUTH_MODE=cognito define EXPO_PUBLIC_COGNITO_DOMAIN y EXPO_PUBLIC_COGNITO_CLIENT_ID.');
}
