import type { Account, Transfer } from '@ambar/api-client';
import { MAX_TRANSFER_CENTAVOS, checkClabe, formatClabe, formatMXN, lastFour, parsePesos } from '@ambar/banking-rules';
import { randomUUID } from 'expo-crypto';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Amount, Body, Button, Card, Field, Notice, Screen, Title } from '@/components/ui';
import { transferApi } from '@/lib/api-adapter';
import { deviceSigner } from '@/lib/device';
import { useSession } from '@/lib/session';
import { space, useTheme } from '@/lib/theme';
import { submitTransfer, type Field as FormField } from '@/lib/transfer-flow';

type Step = 'capture' | 'review' | 'done';
type Errors = Partial<Record<FormField, string>>;

export default function Transferir() {
  const { api, deviceId, beginEnrollment } = useSession();
  const t = useTheme();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [clabe, setClabe] = useState('');
  const [amountText, setAmountText] = useState('');
  const [concept, setConcept] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [step, setStep] = useState<Step>('capture');
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string; enroll?: boolean } | null>(null);
  const [receipt, setReceipt] = useState<{ transfer: Transfer; withDevice: boolean } | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const client = await api();
        const { data } = await client.GET('/v1/accounts');
        const active = (data?.data ?? []).filter((a) => a.status === 'ACTIVE');
        setAccounts(active);
        setSource((s) => s ?? active[0]?.id ?? null);
      })().catch(() => setNotice({ tone: 'error', text: 'No pudimos cargar tus cuentas.' }));
    }, [api]),
  );

  const account = accounts.find((a) => a.id === source);
  const amount = parsePesos(amountText);
  const dest = checkClabe(clabe);

  function validate(): Errors {
    const e: Errors = {};
    if (!account) e.source = 'Elige la cuenta de origen.';
    if (!dest.ok) e.clabe = dest.reason;
    else if (!dest.clabe.startsWith('999')) e.clabe = 'Por ahora solo puedes transferir a cuentas Ámbar (empiezan con 999).';
    else if (account && dest.clabe === account.clabe) e.clabe = 'Es la CLABE de tu cuenta de origen.';
    if (!amount.ok) e.amount = amount.reason;
    else if (amount.centavos > MAX_TRANSFER_CENTAVOS) e.amount = `El máximo por transferencia es ${formatMXN(MAX_TRANSFER_CENTAVOS)}.`;
    else if (account && amount.centavos > account.balance) e.amount = `Tu saldo disponible es ${formatMXN(account.balance)}.`;
    if (!concept.trim()) e.concept = 'Escribe un concepto, por ejemplo "Renta octubre".';
    return e;
  }

  function onContinue() {
    const e = validate();
    setErrors(e);
    setNotice(null);
    if (Object.keys(e).length > 0) return;
    setKey(randomUUID()); // una llave por resumen; los reintentos del mismo resumen la reutilizan
    setStep('review');
  }

  async function onConfirm() {
    if (!account || !amount.ok || !dest.ok || !key) return;
    setBusy(true);
    setNotice(null);
    const op = { source_account_id: account.id, destination_clabe: dest.clabe, amount: amount.centavos, concept: concept.trim() };
    const outcome = await submitTransfer({ api: transferApi(await api()), signer: deviceSigner, deviceId }, op, key);
    setBusy(false);

    switch (outcome.status) {
      case 'done':
        setReceipt({ transfer: outcome.transfer, withDevice: outcome.confirmedWithDevice });
        setStep('done');
        return;
      case 'cancelled':
        setNotice({ tone: 'info', text: 'Cancelaste la confirmación. La transferencia no se envió.' });
        return;
      case 'needs-device':
      case 'device-invalidated':
        setNotice({ tone: 'error', text: outcome.message, enroll: true });
        return;
      case 'error':
        if (outcome.field) {
          setErrors({ [outcome.field]: outcome.message });
          setStep('capture');
        } else {
          setNotice({ tone: 'error', text: outcome.message });
        }
    }
  }

  function restart() {
    setClabe('');
    setAmountText('');
    setConcept('');
    setErrors({});
    setReceipt(null);
    setKey(null);
    setStep('capture');
  }

  if (step === 'done' && receipt) {
    return (
      <Screen>
        <Title>Transferencia enviada</Title>
        <Card>
          <Amount centavos={receipt.transfer.amount} size="xl" />
          <Body muted>Folio</Body>
          <Text selectable testID="folio" style={{ color: t.text, fontVariant: ['tabular-nums'] }}>
            {receipt.transfer.id}
          </Text>
          <Body muted>Hacia CLABE {formatClabe(dest.ok ? dest.clabe : '')}</Body>
          <Body muted>Concepto: {receipt.transfer.concept}</Body>
          {receipt.withDevice ? <Body muted>Confirmada con la biometría de este teléfono.</Body> : null}
        </Card>
        <Button testID="otra" kind="secondary" label="Hacer otra transferencia" onPress={restart} />
      </Screen>
    );
  }

  if (step === 'review' && account && amount.ok && dest.ok) {
    return (
      <Screen>
        <Title>Confirma tu transferencia</Title>
        <Card>
          <Amount centavos={amount.centavos} size="xl" />
          <Body>Desde Débito ••{lastFour(account.clabe)}</Body>
          <Body>Hacia CLABE {formatClabe(dest.clabe)}</Body>
          <Body>Concepto: {concept.trim()}</Body>
          <Body muted>Saldo después: {formatMXN(account.balance - amount.centavos)}</Body>
        </Card>
        {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
        {notice?.enroll ? <Button kind="secondary" label="Activar biometría" onPress={() => void beginEnrollment()} /> : null}
        <Button testID="confirmar" label="Confirmar y enviar" busy={busy} onPress={() => void onConfirm()} />
        <Button kind="quiet" label="Corregir datos" disabled={busy} onPress={() => setStep('capture')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Transferir</Title>
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

      <View style={{ gap: space.xs }}>
        <Text style={{ color: t.text, fontWeight: '600', fontSize: 15 }}>Cuenta de origen</Text>
        {accounts.map((a) => (
          <Pressable
            key={a.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: a.id === source }}
            onPress={() => setSource(a.id)}
            style={{ borderWidth: 1, borderColor: a.id === source ? t.accentFill : t.line, borderRadius: 10, padding: space.md, backgroundColor: t.surface }}
          >
            <Body>
              Débito ••{lastFour(a.clabe)} · disponible {formatMXN(a.balance)}
            </Body>
          </Pressable>
        ))}
        {errors.source ? <Text style={{ color: t.danger }}>{errors.source}</Text> : null}
      </View>

      <Field
        testID="clabe"
        label="CLABE de destino"
        hint="18 dígitos. Revisamos el dígito verificador antes de enviar."
        error={errors.clabe}
        value={clabe}
        onChangeText={setClabe}
        keyboardType="number-pad"
        maxLength={23}
        autoCorrect={false}
      />
      <Field
        testID="monto"
        label="Monto"
        hint={account ? `Disponible: ${formatMXN(account.balance)}` : undefined}
        error={errors.amount}
        value={amountText}
        onChangeText={setAmountText}
        keyboardType="decimal-pad"
        placeholder="0.00"
      />
      <Field
        testID="concepto"
        label="Concepto"
        hint={`${concept.length}/40`}
        error={errors.concept}
        value={concept}
        onChangeText={setConcept}
        maxLength={40}
      />
      <Button testID="continuar" label="Continuar" onPress={onContinue} />
    </Screen>
  );
}
