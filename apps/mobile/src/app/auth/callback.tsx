import { Redirect } from 'expo-router';

/** Destino del redirect de Cognito (ambar://auth/callback): AuthSession ya lo procesó. */
export default function AuthCallback() {
  return <Redirect href="/" />;
}
