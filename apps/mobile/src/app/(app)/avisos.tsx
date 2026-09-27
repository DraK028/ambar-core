import type { Notification } from '@ambar/api-client';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Body, Card, Notice, Title } from '@/components/ui';
import { inboxEvents, KIND_LABEL, needsAction, routeFor } from '@/lib/alerts';
import { useSession } from '@/lib/session';
import { space, useTheme } from '@/lib/theme';

const when = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Avisos() {
  const { api } = useSession();
  const t = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await (await api()).GET('/v1/notifications');
      setItems(data?.data ?? []);
      setError(null);
    } catch {
      setError('No pudimos cargar tus avisos. Desliza hacia abajo para reintentar.');
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function open(n: Notification) {
    if (n.read_at === null) {
      setItems((list) => list?.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)) ?? null);
      try {
        await (await api()).POST('/v1/notifications/{notificationId}/read', { params: { path: { notificationId: n.id } } });
      } finally {
        inboxEvents.emit();
      }
    }
    const route = routeFor({ kind: n.kind, fraud_case_id: n.data.fraud_case_id });
    if (route.pathname !== '/avisos') router.push(route);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <Title>Avisos</Title>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {items && items.length === 0 ? <Body muted>No tienes avisos todavía.</Body> : null}
        {items?.map((n) => {
          const unread = n.read_at === null;
          const action = needsAction(n);
          return (
            <Pressable
              key={n.id}
              testID={`aviso-${n.kind}`}
              accessibilityRole="button"
              accessibilityLabel={`${unread ? 'Sin leer. ' : ''}${n.title}. ${n.body}`}
              accessibilityHint={action ? 'Abre el caso para confirmar si reconoces la transferencia' : undefined}
              onPress={() => void open(n)}
              style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
            >
              <Card>
                <View style={styles.header}>
                  <Text style={[styles.eyebrow, { color: action ? t.danger : t.muted }]}>{KIND_LABEL[n.kind]}</Text>
                  <Text style={{ color: t.muted, fontSize: 13 }}>{when.format(new Date(n.created_at))}</Text>
                </View>
                <View style={styles.titleRow}>
                  {unread ? <View accessible={false} style={[styles.dot, { backgroundColor: action ? t.danger : t.accent }]} /> : null}
                  <Text style={[styles.title, { color: t.text, fontWeight: unread ? '800' : '600' }]}>{n.title}</Text>
                </View>
                <Body muted={!unread}>{n.body}</Body>
                {action ? <Text style={{ color: t.danger, fontWeight: '700' }}>Toca para responder →</Text> : null}
              </Card>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.md },
  header: { flexDirection: 'row', justifyContent: 'space-between' },
  eyebrow: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { fontSize: 17, flexShrink: 1 },
});
