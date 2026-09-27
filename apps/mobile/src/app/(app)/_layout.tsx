import * as Notifications from 'expo-notifications';
import { Redirect, Tabs, useRouter } from 'expo-router';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { inboxEvents, routeFor, unreadBadge } from '@/lib/alerts';
import { registerPushToken } from '@/lib/push';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

export default function AppLayout() {
  const { status, api, deviceId } = useSession();
  const t = useTheme();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const pushRegisteredFor = useRef<string | null>(null);
  const lastResponse = Notifications.useLastNotificationResponse();
  const handledResponse = useRef<string | null>(null);
  // Android: FLAG_SECURE (sin capturas ni grabación). iOS: oculta el contenido al grabar pantalla.
  usePreventScreenCapture();

  // Insignia de avisos sin leer: al entrar, al volver a primer plano y cuando la bandeja cambia.
  useEffect(() => {
    if (status !== 'signed-in') return;
    const refresh = () => {
      api()
        .then((c) => c.GET('/v1/notifications'))
        .then(({ data }) => setUnread(data?.unread_count ?? 0))
        .catch(() => undefined);
    };
    refresh();
    const off = inboxEvents.on(refresh);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => {
      off();
      sub.remove();
    };
  }, [status, api]);

  // Token push ligado al dispositivo con biometría (una vez por sesión).
  useEffect(() => {
    if (status !== 'signed-in' || !deviceId || pushRegisteredFor.current === deviceId) return;
    pushRegisteredFor.current = deviceId;
    api()
      .then((c) => registerPushToken(c, deviceId))
      .catch(() => undefined);
  }, [status, deviceId, api]);

  // Tocar un push abre el aviso (si llegó con la app bloqueada, se atiende al desbloquear).
  useEffect(() => {
    if (status !== 'signed-in' || !lastResponse) return;
    const id = lastResponse.notification.request.identifier;
    if (handledResponse.current === id) return;
    handledResponse.current = id;
    router.push(routeFor(lastResponse.notification.request.content.data as Record<string, unknown>));
  }, [status, lastResponse, router]);

  if (status !== 'signed-in') return <Redirect href="/" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.text,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.line },
        tabBarLabelStyle: { fontSize: 13, fontWeight: '600' },
        tabBarIconStyle: { display: 'none' },
      }}
    >
      <Tabs.Screen name="inicio" options={{ title: 'Inicio', tabBarButtonTestID: 'tab-inicio' }} />
      <Tabs.Screen name="transferir" options={{ title: 'Transferir', tabBarButtonTestID: 'tab-transferir' }} />
      <Tabs.Screen
        name="avisos"
        options={{
          title: 'Avisos',
          tabBarButtonTestID: 'tab-avisos',
          tabBarBadge: unreadBadge(unread),
          tabBarAccessibilityLabel: unread > 0 ? `Avisos, ${unread} sin leer` : 'Avisos',
        }}
      />
      <Tabs.Screen name="asistente" options={{ title: 'Asistente', tabBarButtonTestID: 'tab-asistente' }} />
      <Tabs.Screen name="ajustes" options={{ title: 'Ajustes', tabBarButtonTestID: 'tab-ajustes' }} />
      {/* Pantalla de detalle: se llega desde un aviso, no desde la barra. */}
      <Tabs.Screen name="caso/[id]" options={{ href: null, title: 'Caso' }} />
    </Tabs>
  );
}
