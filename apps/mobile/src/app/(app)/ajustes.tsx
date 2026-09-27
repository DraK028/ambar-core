import type { Device } from '@ambar/api-client';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { Body, Button, Card, Notice, Screen, Title } from '@/components/ui';
import { useSession } from '@/lib/session';
import { space, useTheme } from '@/lib/theme';

const date = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium' });

export default function Ajustes() {
  const { api, deviceId, sub, lock, signOut, beginEnrollment } = useSession();
  const t = useTheme();
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await (await api()).GET('/v1/devices');
      setDevices((data?.data ?? []).filter((d) => d.status === 'ACTIVE'));
    } catch {
      setError('No pudimos cargar tus dispositivos.');
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function revoke(id: string) {
    await (await api()).DELETE('/v1/devices/{deviceId}', { params: { path: { deviceId: id } } });
    await load();
  }

  return (
    <Screen>
      <Title>Ajustes</Title>
      <Body muted>Sesión de {sub}</Body>
      {error ? <Notice tone="error">{error}</Notice> : null}

      <View style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>
          Dispositivos con biometría
        </Text>
        {devices.length === 0 ? <Body muted>Ningún teléfono tiene la biometría activada.</Body> : null}
        {devices.map((d) => (
          <Card key={d.id}>
            <Body>
              {d.name}
              {d.id === deviceId ? ' · este teléfono' : ''}
            </Body>
            <Body muted>
              Activado el {date.format(new Date(d.created_at))}
              {d.last_used_at ? ` · última confirmación ${date.format(new Date(d.last_used_at))}` : ''}
            </Body>
            {d.id !== deviceId ? <Button kind="secondary" label={`Revocar ${d.name}`} onPress={() => void revoke(d.id)} /> : null}
          </Card>
        ))}
        {!deviceId ? <Button kind="secondary" label="Activar biometría en este teléfono" onPress={() => void beginEnrollment()} /> : null}
      </View>

      <Button testID="bloquear" kind="secondary" label="Bloquear ahora" onPress={lock} />
      <Button testID="salir" kind="quiet" label="Cerrar sesión en este teléfono" onPress={() => void signOut()} />
    </Screen>
  );
}
