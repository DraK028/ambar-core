const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const dateParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** 125050 → "$1,250.50"; con signo explícito → "+$1,250.50" / "−$1,250.50". */
export function money(centavos: number, signed = false): string {
  const abs = mxn.format(Math.abs(centavos) / 100);
  if (!signed) return centavos < 0 ? `−${abs}` : abs;
  return centavos > 0 ? `+${abs}` : centavos < 0 ? `−${abs}` : abs;
}

function parts(at: Date): Record<string, string> {
  return Object.fromEntries(dateParts.formatToParts(at).map((p) => [p.type, p.value]));
}

/** Fecha y hora en la Ciudad de México: "2026-09-27 08:14". */
export function localDateTime(at: Date): string {
  const p = parts(at);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

export function localDate(at: Date): string {
  return localDateTime(at).slice(0, 10);
}

/** "2026-09" del mes en curso en la Ciudad de México. */
export function localMonth(at: Date): string {
  return localDateTime(at).slice(0, 7);
}
