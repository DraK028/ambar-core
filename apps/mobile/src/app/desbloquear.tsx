import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Body, Button, Notice, Screen, Title } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

export default function Desbloquear() {
  const { unlock, signOut, notice } = useSession();
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const asked = useRef(false);

  async function go() {
    setBusy(true);
    await unlock();
    setBusy(false);
  }

  // Al abrir la app, el diálogo biométrico aparece solo una vez; después, con el botón.
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen>
      <View style={{ gap: 12, marginTop: 64, alignItems: 'flex-start' }}>
        <Text style={{ fontSize: 40, fontWeight: '800', color: t.text }}>
          Ámbar<Text style={{ color: t.accentFill }}>.</Text>
        </Text>
        <Title>La app está bloqueada</Title>
        <Body muted>Usa tu huella o tu rostro para continuar.</Body>
      </View>
      {notice ? <Notice tone="error">{notice}</Notice> : null}
      <Button testID="desbloquear" label="Desbloquear" busy={busy} onPress={go} />
      <Button testID="otra-cuenta" kind="quiet" label="Entrar con otra cuenta" onPress={() => void signOut()} />
    </Screen>
  );
}
