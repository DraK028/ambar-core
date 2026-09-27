import { formatMXN, splitAmount } from '@ambar/banking-rules';

/** Monto con centavos reducidos. El lector de pantalla recibe el monto completo en una sola lectura. */
export function Amount({ centavos, className = '', signed = false }: { centavos: number; className?: string; signed?: boolean }) {
  const { sign, pesos, cents } = splitAmount(centavos);
  const prefix = sign === '-' ? '−' : signed && centavos > 0 ? '+' : '';
  const spoken = `${prefix === '+' ? 'más ' : prefix === '−' ? 'menos ' : ''}${formatMXN(Math.abs(centavos))}`;
  return (
    <span className={`amount ${className}`}>
      <span aria-hidden="true">
        {prefix}${pesos}
        <span className="cents">.{cents}</span>
      </span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}
