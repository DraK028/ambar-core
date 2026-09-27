import { makeRedirectUri, useAuthRequest } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Body, Button, Field, Notice, Screen, Title } from '@/components/ui';
import { config } from '@/lib/config';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { cognitoEndpoints, devLogin, exchangeCode } from '@/lib/tokens';

WebBrowser.maybeCompleteAuthSession();

const SCOPES = [
  'openid',
  'email',
  'ambar-api/accounts.read',
  'ambar-api/accounts.write',
  'ambar-api/transfers.write',
  'ambar-api/devices.write',
];
const redirectUri = makeRedirectUri({ scheme: 'ambar', path: 'auth/callback' });

function CognitoLogin() {
  const { completeLogin } = useSession();
  const endpoints = useMemo(() => cognitoEndpoints(config.cognitoDomain!), []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // PKCE: expo-auth-session genera el verifier y el challenge S256.
  const [request, response, promptAsync] = useAuthRequest(
    { clientId: config.cognitoClientId!, scopes: SCOPES, redirectUri, usePKCE: true },
    endpoints,
  );

  useEffect(() => {
    if (response?.type !== 'success' || !request?.codeVerifier) {
      if (response?.type === 'error') setError('Cognito rechazó el inicio de sesión. Intenta de nuevo.');
      return;
    }
    setBusy(true);
    exchangeCode({ tokenEndpoint: endpoints.tokenEndpoint, clientId: config.cognitoClientId!, code: response.params.code, redirectUri, codeVerifier: request.codeVerifier })
      .then(completeLogin)
      .catch(() => setError('No pudimos completar el inicio de sesión.'))
      .finally(() => setBusy(false));
  }, [response, request, completeLogin, endpoints.tokenEndpoint]);

  return (
    <>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button testID="login" label="Iniciar sesión" busy={busy} disabled={!request} onPress={() => void promptAsync()} />
    </>
  );
}

function LocalLogin() {
  const { completeLogin } = useSession();
  const [user, setUser] = useState('demo-ana');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await completeLogin(await devLogin({ devAuthUrl: config.devAuthUrl, sub: user.trim().toLowerCase() }));
    } catch {
      setError('No hay servidor de tokens de desarrollo. Ejecuta tools/dev-auth-server.mjs.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Notice>Modo local: sin Cognito, con el servidor de tokens de desarrollo. No existe en builds de AWS.</Notice>
      <Field label="Usuario de prueba" value={user} onChangeText={setUser} autoCapitalize="none" autoCorrect={false} testID="local-user" />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button testID="login" label="Entrar" busy={busy} onPress={go} />
    </>
  );
}

export default function Bienvenida() {
  const { notice } = useSession();
  const t = useTheme();
  return (
    <Screen>
      <View style={{ gap: 12, marginTop: 48 }}>
        <Text style={{ fontSize: 40, fontWeight: '800', color: t.text }}>
          Ámbar<Text style={{ color: t.accentFill }}>.</Text>
        </Text>
        <Title>Tu banca, en tu mano</Title>
        <Body muted>Consulta tu saldo, transfiere en pesos y confirma cada operación con tu huella o tu rostro.</Body>
      </View>
      {notice ? <Notice>{notice}</Notice> : null}
      {config.authMode === 'cognito' ? <CognitoLogin /> : <LocalLogin />}
    </Screen>
  );
}
