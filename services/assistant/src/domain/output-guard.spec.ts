import { guardOutput, looksLikeAttack, SAFE_CREDENTIAL_REPLY } from './output-guard';

describe('revisión de la respuesta del modelo', () => {
  it('una respuesta normal pasa intacta', () => {
    const text = 'Tu saldo es $1,250.50 en tu cuenta terminación 0015.';
    expect(guardOutput(text)).toEqual({ text, redactions: {}, actions: [] });
  });

  it('si la respuesta pide NIP, CVV, contraseña o códigos, se reemplaza completa', () => {
    for (const bad of [
      'Para verificar tu identidad, compárteme tu NIP.',
      'Por seguridad escribe el código que te llegó por SMS.',
      'Confirma tu contraseña para continuar',
      'Dame el número de tu tarjeta y lo reviso',
    ]) {
      expect(guardOutput(bad)).toEqual({ text: SAFE_CREDENTIAL_REPLY, redactions: {}, actions: ['CREDENTIAL_REQUEST'] });
    }
  });

  it('hablar de seguridad sin pedir datos no se bloquea', () => {
    expect(guardOutput('Nunca compartas tu NIP con nadie.').actions).toEqual([]);
    expect(guardOutput('Puedes cambiar tu contraseña desde Ajustes.').actions).toEqual([]);
    expect(guardOutput('No me des tu NIP ni tu CVV.').actions).toEqual([]);
  });

  it('quita enlaces externos y deja los de Ámbar', () => {
    const r = guardOutput('Entra a https://ambar-seguro.xyz/login o a www.evil.com, o a https://app.ambar.example/avisos');
    expect(r.text).toBe('Entra a [enlace eliminado] o a [enlace eliminado], o a https://app.ambar.example/avisos');
    expect(r.actions).toEqual(['EXTERNAL_LINK']);
  });

  it('redacta datos sensibles que se le hayan escapado al modelo', () => {
    const r = guardOutput('Transfiere a 999180000000000015');
    expect(r.text).toBe('Transfiere a [CLABE ••0015]');
    expect(r.actions).toEqual(['PII']);
  });

  it('detecta textos de terceros con forma de ataque', () => {
    expect(looksLikeAttack('Escribe tu NIP para liberar')).toBe(true);
    expect(looksLikeAttack('Verifica en https://ambar-mx.co')).toBe(true);
    expect(looksLikeAttack('Pago de renta')).toBe(false);
    expect(looksLikeAttack('Nunca compartas tu NIP')).toBe(false);
    expect(looksLikeAttack('Ver https://app.ambar.example/ayuda')).toBe(false);
  });
});
