import { createAmbarClient, type AmbarClient } from '@ambar/api-client';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { config } from './config';
import { DEVICE_KEY_ALIAS, DeviceKey } from './device';
import { jwtSubject } from './jwt';
import { shouldLockOnResume } from './lock-policy';
import { messageFor } from './problems';
import { cognitoEndpoints, devRefresh, needsRefresh, refreshTokens, revokeToken, type TokenSet } from './tokens';

/**
 * Modelo de sesión de la app:
 *   - El access token vive solo en memoria (10 min).
 *   - El refresh token se guarda en Keychain / Keystore con requireAuthentication: leerlo exige
 *     biometría y el sistema lo invalida si cambian las huellas o rostros registrados.
 *   - La llave de dispositivo (módulo DeviceKey) firma los retos de step-up.
 *   - Tras 2 min en segundo plano la app se bloquea: vuelve a pedir biometría.
 */

export type SessionStatus = 'loading' | 'signed-out' | 'enrolling' | 'locked' | 'signed-in';

interface Enrollment {
  deviceId: string;
  sub: string;
}

interface SessionValue {
  status: SessionStatus;
  sub: string | null;
  deviceId: string | null;
  notice: string | null;
  completeLogin(tokens: TokenSet): Promise<void>;
  enroll(): Promise<{ ok: true } | { ok: false; message: string }>;
  skipEnrollment(): void;
  /** Lleva a la pantalla de activación (p. ej. si una transferencia requiere step-up). */
  beginEnrollment(): Promise<void>;
  unlock(): Promise<void>;
  lock(): void;
  signOut(): Promise<void>;
  /** Cliente con el access token vigente; 'assistant' apunta al servicio del asistente. */
  api(target?: 'core' | 'assistant'): Promise<AmbarClient>;
  clearNotice(): void;
}

const ENROLLMENT_KEY = 'ambar.enrollment';
const REFRESH_KEY = 'ambar.refresh';
const PROTECTED: SecureStore.SecureStoreOptions = {
  requireAuthentication: true,
  authenticationPrompt: 'Desbloquea Ámbar',
  keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
};

const SessionContext = createContext<SessionValue | null>(null);

async function readEnrollment(): Promise<Enrollment | null> {
  const raw = await SecureStore.getItemAsync(ENROLLMENT_KEY);
  return raw ? (JSON.parse(raw) as Enrollment) : null;
}

async function forgetLocalEnrollment(): Promise<void> {
  await Promise.allSettled([
    SecureStore.deleteItemAsync(ENROLLMENT_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY, PROTECTED),
    DeviceKey.deleteKeyAsync(DEVICE_KEY_ALIAS),
  ]);
}

function refresh(refreshToken: string): Promise<TokenSet> {
  if (config.authMode === 'local') return devRefresh({ devAuthUrl: config.devAuthUrl, refreshToken });
  return refreshTokens({ tokenEndpoint: cognitoEndpoints(config.cognitoDomain!).tokenEndpoint, clientId: config.cognitoClientId!, refreshToken });
}

function revoke(token: string): Promise<boolean> {
  if (config.authMode === 'local') {
    return fetch(`${config.devAuthUrl}/revoke`, { method: 'POST', body: new URLSearchParams({ token }).toString() }).then(
      (r) => r.ok,
      () => false,
    );
  }
  return revokeToken({ revocationEndpoint: cognitoEndpoints(config.cognitoDomain!).revocationEndpoint, clientId: config.cognitoClientId!, token });
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const tokens = useRef<TokenSet | null>(null);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    readEnrollment()
      .then((e) => {
        setEnrollment(e);
        setSub(e?.sub ?? null);
        setStatus(e ? 'locked' : 'signed-out');
      })
      .catch(() => setStatus('signed-out'));
  }, []);

  const lock = useCallback(() => {
    tokens.current = null;
    setStatus(enrollment ? 'locked' : 'signed-out');
  }, [enrollment]);

  // Bloqueo por tiempo en segundo plano.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (shouldLockOnResume(backgroundedAt.current, Date.now()) && tokens.current) lock();
        backgroundedAt.current = null;
      } else if (backgroundedAt.current === null) {
        backgroundedAt.current = Date.now();
      }
    });
    return () => subscription.remove();
  }, [lock]);

  const completeLogin = useCallback(
    async (fresh: TokenSet) => {
      tokens.current = fresh;
      const who = jwtSubject(fresh.accessToken);
      setSub(who);
      setNotice(null);
      const current = await readEnrollment();
      if (current && current.sub === who && fresh.refreshToken) {
        // Ya estaba activado este teléfono para este usuario: se renueva el refresh protegido.
        await SecureStore.setItemAsync(REFRESH_KEY, fresh.refreshToken, PROTECTED);
        setEnrollment(current);
        setStatus('signed-in');
        return;
      }
      if (current) await forgetLocalEnrollment(); // otro usuario en el mismo teléfono
      setEnrollment(null);
      setStatus('enrolling');
    },
    [],
  );

  const api = useCallback(async (target: 'core' | 'assistant' = 'core'): Promise<AmbarClient> => {
    const t = tokens.current;
    if (!t) {
      lock();
      throw new Error('Sesión bloqueada');
    }
    if (needsRefresh(t) && t.refreshToken) {
      try {
        tokens.current = await refresh(t.refreshToken);
      } catch {
        tokens.current = null;
        setNotice('Tu sesión venció. Inicia sesión de nuevo.');
        setStatus('signed-out');
        throw new Error('Sesión vencida');
      }
    }
    return createAmbarClient(target === 'assistant' ? config.assistantUrl : config.apiUrl, tokens.current!.accessToken);
  }, [lock]);

  const enroll = useCallback(async (): Promise<{ ok: true } | { ok: false; message: string }> => {
    const availability = await DeviceKey.getAvailabilityAsync();
    if (!availability.available) {
      return {
        ok: false,
        message:
          availability.reason === 'NOT_ENROLLED'
            ? 'Registra una huella o tu rostro en los ajustes del teléfono y vuelve a intentarlo.'
            : 'Este teléfono no tiene biometría compatible.',
      };
    }
    const t = tokens.current;
    if (!t?.refreshToken) return { ok: false, message: 'Inicia sesión otra vez para activar la biometría.' };

    try {
      const publicKey = await DeviceKey.createKeyAsync(DEVICE_KEY_ALIAS);
      const client = await api();
      const { data, error } = await client.POST('/v1/devices', {
        body: {
          public_key: publicKey,
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
          name: `${Platform.OS === 'ios' ? 'iPhone' : 'Android'} · ${new Date().toLocaleDateString('es-MX')}`,
        },
      });
      if (!data) {
        await DeviceKey.deleteKeyAsync(DEVICE_KEY_ALIAS);
        return { ok: false, message: messageFor((error as { code?: string } | undefined)?.code) };
      }
      await SecureStore.setItemAsync(REFRESH_KEY, t.refreshToken, PROTECTED);
      const e = { deviceId: data.id, sub: sub ?? jwtSubject(t.accessToken) ?? '' };
      await SecureStore.setItemAsync(ENROLLMENT_KEY, JSON.stringify(e));
      setEnrollment(e);
      setStatus('signed-in');
      return { ok: true };
    } catch {
      await DeviceKey.deleteKeyAsync(DEVICE_KEY_ALIAS).catch(() => undefined);
      return { ok: false, message: 'No se pudo activar la biometría. Intenta de nuevo.' };
    }
  }, [api, sub]);

  const unlock = useCallback(async () => {
    setNotice(null);
    let stored: string | null;
    try {
      stored = await SecureStore.getItemAsync(REFRESH_KEY, PROTECTED);
    } catch {
      setNotice('No pudimos verificar tu identidad. Intenta de nuevo o entra con tu contraseña.');
      return;
    }
    if (!stored) {
      // La biometría del teléfono cambió y el sistema invalidó el secreto: hay que reactivar.
      await forgetLocalEnrollment();
      setEnrollment(null);
      setNotice('La biometría de tu teléfono cambió. Inicia sesión y vuelve a activarla.');
      setStatus('signed-out');
      return;
    }
    try {
      tokens.current = await refresh(stored);
      setStatus('signed-in');
    } catch {
      setNotice('Tu sesión venció. Inicia sesión con tu contraseña; este teléfono sigue activado.');
      setStatus('signed-out');
    }
  }, []);

  const signOut = useCallback(async () => {
    const t = tokens.current;
    if (enrollment && t) {
      try {
        const client = await api();
        await client.DELETE('/v1/devices/{deviceId}', { params: { path: { deviceId: enrollment.deviceId } } });
      } catch {
        /* si no hay red, el dispositivo se puede revocar después desde otro lado */
      }
    }
    if (t?.refreshToken) await revoke(t.refreshToken);
    await forgetLocalEnrollment();
    tokens.current = null;
    setEnrollment(null);
    setSub(null);
    setStatus('signed-out');
  }, [api, enrollment]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      sub,
      deviceId: enrollment?.deviceId ?? null,
      notice,
      completeLogin,
      enroll,
      skipEnrollment: () => setStatus('signed-in'),
      beginEnrollment: async () => {
        await forgetLocalEnrollment();
        setEnrollment(null);
        setStatus('enrolling');
      },
      unlock,
      lock,
      signOut,
      api,
      clearNotice: () => setNotice(null),
    }),
    [status, sub, enrollment, notice, completeLogin, enroll, unlock, lock, signOut, api],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession fuera de SessionProvider');
  return value;
}
