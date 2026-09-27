import type { Movement } from '@ambar/api-client';
import { Amount } from './Amount';

const TZ = 'America/Mexico_City';
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayLabel = new Intl.DateTimeFormat('es-MX', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
const timeLabel = new Intl.DateTimeFormat('es-MX', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

const KIND: Record<Movement['kind'], string> = {
  TRANSFER: 'Transferencia',
  DEPOSIT: 'Depósito SPEI',
  REVERSAL: 'Reverso',
};

function relativeDay(key: string, now: Date): string {
  const today = dayKey.format(now);
  const yesterday = dayKey.format(new Date(now.getTime() - 86_400_000));
  if (key === today) return 'Hoy';
  if (key === yesterday) return 'Ayer';
  const label = dayLabel.format(new Date(`${key}T12:00:00-06:00`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Movimientos agrupados por día en hora del centro de México. Abonos en verde; cargos en color de texto. */
export function MovementList({ movements, now = new Date() }: { movements: Movement[]; now?: Date }) {
  if (movements.length === 0) {
    return <p className="empty">Todavía no hay movimientos en esta cuenta.</p>;
  }
  const groups = new Map<string, Movement[]>();
  for (const m of movements) {
    const key = dayKey.format(new Date(m.created_at));
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return (
    <div>
      {[...groups].map(([key, items]) => (
        <section key={key} aria-label={relativeDay(key, now)}>
          <h3 className="day">{relativeDay(key, now)}</h3>
          <ul className="movements">
            {items.map((m) => (
              <li key={m.id} className="movement">
                <span className="what">{m.description}</span>
                <Amount centavos={m.amount} signed className={m.amount > 0 ? 'credit' : ''} />
                <span className="kind">
                  {KIND[m.kind]} · {timeLabel.format(new Date(m.created_at))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
