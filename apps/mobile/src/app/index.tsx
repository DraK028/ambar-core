import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

export default function Index() {
  const { status } = useSession();
  const t = useTheme();
  switch (status) {
    case 'signed-in':
      return <Redirect href="/inicio" />;
    case 'locked':
      return <Redirect href="/desbloquear" />;
    case 'enrolling':
      return <Redirect href="/activar" />;
    case 'signed-out':
      return <Redirect href="/bienvenida" />;
    default:
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}>
          <ActivityIndicator accessibilityLabel="Cargando" />
        </View>
      );
  }
}
