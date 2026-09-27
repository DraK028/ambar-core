'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

const WARN_BEFORE_MS = 60_000;

/**
 * WCAG 2.2.1 (Tiempo ajustable): avisa 60 s antes de que la sesión venza por inactividad
 * y permite extenderla. Cada navegación consulta al servidor la nueva hora de vencimiento.
 * El conteo usa el reloj del servidor (con el desfase medido), no el del dispositivo, que
 * puede estar adelantado o atrasado.
 */
export function SessionTimeout() {
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [deadline, setDeadline] = useState<{ expiresAt: number; offset: number } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(60);

  const sync = useCallback(async (method: 'GET' | 'POST') => {
    try {
      const res = await fetch('/api/session', { method, cache: 'no-store' });
      if (res.status === 401) {
        window.location.assign('/entrar?motivo=inactividad');
        return;
      }
      if (res.ok) {
        const body = (await res.json()) as { idleExpiresAt: number; now: number };
        setDeadline({ expiresAt: body.idleExpiresAt, offset: body.now - Date.now() });
      }
    } catch {
      /* sin red: se reintenta en la siguiente navegación */
    }
  }, []);

  useEffect(() => {
    void sync('GET');
  }, [pathname, sync]);

  useEffect(() => {
    if (!deadline) return;
    const tick = () => {
      const left = deadline.expiresAt - (Date.now() + deadline.offset);
      if (left <= 0) {
        window.location.assign('/entrar?motivo=inactividad');
        return;
      }
      if (left <= WARN_BEFORE_MS) {
        setSecondsLeft(Math.ceil(left / 1000));
        if (!dialogRef.current?.open) dialogRef.current?.showModal();
      } else if (dialogRef.current?.open) {
        dialogRef.current.close();
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [deadline]);

  async function stay() {
    await sync('POST');
    dialogRef.current?.close();
  }

  return (
    <dialog ref={dialogRef} className="timeout" aria-labelledby="timeout-title" aria-describedby="timeout-desc">
      <div className="section">
        <h2 id="timeout-title">¿Sigues ahí?</h2>
        <p id="timeout-desc">
          Por seguridad cerraremos tu sesión en <strong>{secondsLeft} s</strong> si no hay actividad.
        </p>
        <div className="actions">
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="btn">
              Salir ahora
            </button>
          </form>
          <button type="button" className="btn btn-primary" onClick={stay} autoFocus>
            Seguir conectado
          </button>
        </div>
      </div>
    </dialog>
  );
}
