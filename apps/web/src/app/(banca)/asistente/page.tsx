import type { Metadata } from 'next';
import { AssistantChat } from './AssistantChat';

export const metadata: Metadata = { title: 'Asistente · Ámbar' };

export default function AsistentePage() {
  return (
    <>
      <div className="section-head">
        <div>
          <p className="eyebrow">Asistente financiero</p>
          <h1>Pregúntale a Ámbar</h1>
        </div>
      </div>
      <p className="muted">
        Consulta tu saldo, tus movimientos, en qué gastaste este mes o tus avisos. El asistente solo puede leer tu información:
        no hace transferencias ni cambios. Nunca escribas tu NIP, CVV ni contraseñas.
      </p>
      <AssistantChat />
    </>
  );
}
