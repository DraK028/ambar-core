import type { Account, Movement } from '@ambar/api-client';
import { formatClabe, lastFour } from '@ambar/banking-rules';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Amount, Body, Button, Card, Eyebrow, Notice, Title } from '@/components/ui';
import { useSession } from '@/lib/session';
import { space, useTheme } from '@/lib/theme';

const KIND: Record<Movement['kind'], string> = { TRANSFER: 'Transferencia', DEPOSIT: 'Depósito SPEI', REVERSAL: 'Reverso' };
const when = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Inicio() {
  const { api } = useSession();
  const t = useTheme();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const client = await api();
      const { data } = await client.GET('/v1/accounts');
      const list = data?.data ?? [];
      setAccounts(list);
      if (list[0]) {
        const m = await client.GET('/v1/accounts/{accountId}/movements', { params: { path: { accountId: list[0].id }, query: { limit: 10 } } });
        setMovements(m.data?.data ?? []);
      }
      setError(null);
    } catch {
      setError('No pudimos cargar tu información. Desliza hacia abajo para reintentar.');
    }
  }, [api]);

  // Recarga cada vez que la pestaña vuelve a tener foco (p. ej. después de transferir).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function openAccount() {
    const client = await api();
    await client.POST('/v1/accounts');
    await load();
  }

  const total = accounts?.reduce((sum, a) => sum + a.balance, 0) ?? 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        {error ? <Notice tone="error">{error}</Notice> : null}
        {accounts && accounts.length === 0 ? (
          <Card>
            <Title>Bienvenido a Ámbar</Title>
            <Body muted>Abre tu cuenta de débito en pesos y recibe tu CLABE al instante.</Body>
            <Button testID="abrir-cuenta" label="Abrir mi cuenta" onPress={() => void openAccount()} />
          </Card>
        ) : null}

        {accounts && accounts.length > 0 ? (
          <>
            <Card>
              <Eyebrow>Saldo disponible</Eyebrow>
              <View testID="saldo-total" accessibilityLiveRegion="polite">
                <Amount centavos={total} size="xl" />
              </View>
              {accounts.map((a) => (
                <View key={a.id} style={styles.row}>
                  <Body muted>Débito ••{lastFour(a.clabe)}</Body>
                  <Text selectable style={{ color: t.muted, fontVariant: ['tabular-nums'] }}>
                    {formatClabe(a.clabe)}
                  </Text>
                </View>
              ))}
            </Card>

            <View style={{ gap: space.sm }}>
              <Text accessibilityRole="header" style={[styles.h2, { color: t.text }]}>
                Movimientos recientes
              </Text>
              <Card>
                {movements.length === 0 ? <Body muted>Todavía no hay movimientos.</Body> : null}
                {movements.map((m, i) => (
                  <View key={m.id} style={[styles.movement, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line }]}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Body>{m.description}</Body>
                      <Text style={{ color: t.muted, fontSize: 13 }}>
                        {KIND[m.kind]} · {when.format(new Date(m.created_at))}
                      </Text>
                    </View>
                    <Amount centavos={m.amount} signed />
                  </View>
                ))}
              </Card>
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.lg },
  row: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.sm },
  h2: { fontSize: 18, fontWeight: '700' },
  movement: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
});
