import type { FraudCase } from '@ambar/api-client';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Amount, Body, Button, Card, Eyebrow, Notice, Screen, Title } from '@/components/ui';
import { inboxEvents, REASON_TEXT } from '@/lib/alerts';
import { messageFor } from '@/lib/problems';
import { useSession } from '@/lib/session';
import { space, useTheme } from '@/lib/theme';

const when = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' });

export default function Caso() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const t = useTheme();
  const router = useRouter();
  const [fraudCase, setFraudCase] = useState<FraudCase | null>(null);
  const [frozen, setFrozen] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null);

  const load = useCallback(async () => {
    try {
      const { data, error: problem } = await (await api()).GET('/v1/fraud-cases/{caseId}', { params: { path: { caseId: id } } });
      if (!data) {
        setError(problem?.code === 'NOT_FOUND' ? 'Este caso no existe.' : messageFor(problem?.code));
        return;
      }
      setFraudCase(data);
      setError(null);
    } catch {
      setError(messageFor('NETWORK'));
    }
  }, [api, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function answer(recognized: boolean) {
    setBusy(recognized ? 'yes' : 'no');
    try {
      const { data, error: problem } = await (await api()).POST('/v1/fraud-cases/{caseId}/answer', {
        params: { path: { caseId: id } },
        body: { recognized },
      });
      if (!data) {
        setError(problem?.code === 'FRAUD_CASE_CLOSED' ? 'Este caso ya tenía otra respuesta. Si fue un error, llámanos.' : messageFor(problem?.code));
        return;
      }
      const { account_frozen, ...rest } = data;
      setFraudCase(rest);
      setFrozen(account_frozen);
      inboxEvents.emit();
    } catch {
      setError(messageFor('NETWORK'));
    } finally {
      setBusy(null);
    }
  }

  function confirmNotMe() {
    Alert.alert(
      '¿No reconoces la transferencia?',
      'Congelaremos tu cuenta de inmediato: podrás recibir dinero, pero no enviarlo hasta que revisemos el caso contigo.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Congelar mi cuenta', style: 'destructive', onPress: () => void answer(false) },
      ],
    );
  }

  return (
    <Screen>
      <Title focusable>¿Reconoces esta transferencia?</Title>
      {error ? <Notice tone="error">{error}</Notice> : null}

      {fraudCase ? (
        <>
          <Card>
            <Eyebrow>Transferencia enviada</Eyebrow>
            <Amount centavos={fraudCase.transfer.amount} size="xl" />
            <Body>A la cuenta terminación {fraudCase.transfer.destination_clabe_last4}</Body>
            <Body muted>
              “{fraudCase.transfer.concept}” · {when.format(new Date(fraudCase.transfer.created_at))}
            </Body>
          </Card>

          {fraudCase.reasons.length > 0 ? (
            <View style={{ gap: space.xs }}>
              <Text accessibilityRole="header" style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>
                Por qué te preguntamos
              </Text>
              {fraudCase.reasons.map((r) => (
                <Body key={r} muted>
                  • {REASON_TEXT[r]}
                </Body>
              ))}
            </View>
          ) : null}

          {fraudCase.status === 'OPEN' ? (
            <View style={{ gap: space.sm }}>
              <Button testID="caso-si" label="Sí, fui yo" busy={busy === 'yes'} disabled={busy !== null} onPress={() => void answer(true)} />
              <Button testID="caso-no" kind="secondary" label="No la reconozco" busy={busy === 'no'} disabled={busy !== null} onPress={confirmNotMe} />
            </View>
          ) : (
            <Notice tone={fraudCase.status === 'NOT_RECOGNIZED' ? 'error' : 'info'}>
              {fraudCase.status === 'RECOGNIZED'
                ? 'Gracias. Marcamos la transferencia como reconocida.'
                : frozen === false
                  ? 'Registramos que no reconoces la transferencia. Te contactaremos para revisarla.'
                  : 'Congelamos tu cuenta: puedes recibir dinero, pero no enviarlo. Te contactaremos para revisar la transferencia.'}
            </Notice>
          )}

          <Button kind="quiet" label="Volver a avisos" onPress={() => router.navigate('/avisos')} />
        </>
      ) : null}
    </Screen>
  );
}
