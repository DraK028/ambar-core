import type { AmbarClient } from '@ambar/api-client';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { config } from './config';

/**
 * Notificaciones push con Expo. El servidor (n8n) decide qué se envía; por defecto el texto
 * es genérico ("Tienes un aviso nuevo") para no mostrar montos en la pantalla bloqueada.
 * El token se liga al dispositivo registrado: al revocarlo, el core lo borra.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export type PushSetup = { ok: true; token: string } | { ok: false; reason: 'SIMULATOR' | 'DENIED' | 'NOT_CONFIGURED' | 'ERROR' };

export async function obtainPushToken(): Promise<PushSetup> {
  if (!Device.isDevice) return { ok: false, reason: 'SIMULATOR' };
  if (!config.easProjectId) return { ok: false, reason: 'NOT_CONFIGURED' };
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Avisos de Ámbar',
        importance: Notifications.AndroidImportance.HIGH,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
    }
    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted;
    if (!granted && current.canAskAgain) granted = (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return { ok: false, reason: 'DENIED' };
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: config.easProjectId });
    return { ok: true, token: data };
  } catch {
    return { ok: false, reason: 'ERROR' };
  }
}

/** Registra el token en el dispositivo activo. Silencioso si falla: los avisos siguen llegando a la bandeja. */
export async function registerPushToken(client: AmbarClient, deviceId: string): Promise<PushSetup> {
  const setup = await obtainPushToken();
  if (setup.ok) {
    await client.PUT('/v1/devices/{deviceId}/push-token', {
      params: { path: { deviceId } },
      body: { push_token: setup.token },
    });
  }
  return setup;
}
