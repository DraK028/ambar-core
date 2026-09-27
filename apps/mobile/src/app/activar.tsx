import { useState } from 'react';
import { View } from 'react-native';
import { Body, Button, Card, Notice, Screen, Title } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function Activar() {
  const { enroll, skipEnrollment } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function activate() {
    setBusy(true);
    setError(null);
    const result = await enroll();
    setBusy(false);
    if (!result.ok) setError(result.message);
  }

  return (
    <Screen>
      <View style={{ gap: 12, marginTop: 32 }}>
        <Title>Activa tu huella o tu rostro</Title>
        <Body muted>Así entrarás sin contraseña y podrás confirmar transferencias importantes desde este teléfono.</Body>
      </View>
      <Card>
        <Body>• Tu teléfono crea una llave que nunca sale de su chip de seguridad.</Body>
        <Body>• Ámbar solo guarda la parte pública de esa llave.</Body>
        <Body>• Si agregas una huella o un rostro nuevo, tendrás que volver a activarla.</Body>
      </Card>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button testID="activar" label="Activar biometría" busy={busy} onPress={activate} />
      <Button testID="omitir" kind="quiet" label="Ahora no" onPress={skipEnrollment} />
    </Screen>
  );
}
