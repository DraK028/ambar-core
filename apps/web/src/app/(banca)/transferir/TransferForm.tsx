'use client';

import type { Account } from '@ambar/api-client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';
import { Amount } from '@/components/Amount';
import { CheckIcon } from '@/components/icons';
import { MAX_TRANSFER_CENTAVOS, checkClabe, formatClabe, formatMXN, lastFour, parsePesos } from '@ambar/banking-rules';
import { transferAction } from './actions';
import type { TransferField, TransferState } from './types';

type Step = 'capture' | 'review' | 'done';
type Errors = Partial<Record<TransferField, string>>;

const LABELS: Record<TransferField, string> = {
  source: 'Cuenta de origen',
  clabe: 'CLABE de destino',
  amount: 'Monto',
  concept: 'Concepto',
};

const dateTime = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'long', timeStyle: 'short' });

/** Envoltorio: "Hacer otra transferencia" monta un formulario nuevo y recarga los saldos. */
export function TransferForm(props: { accounts: Account[]; initialSource: string }) {
  const [round, setRound] = useState(0);
  const router = useRouter();
  return (
    <TransferFlow
      key={round}
      {...props}
      onRestart={() => {
        setRound((r) => r + 1);
        router.refresh();
      }}
    />
  );
}

function TransferFlow({ accounts, initialSource, onRestart }: { accounts: Account[]; initialSource: string; onRestart: () => void }) {
  const [step, setStep] = useState<Step>('capture');
  const [source, setSource] = useState(initialSource);
  const [clabe, setClabe] = useState('');
  const [amountText, setAmountText] = useState('');
  const [concept, setConcept] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [result, formAction, pending] = useActionState<TransferState, FormData>(transferAction, { status: 'idle' });

  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  const account = accounts.find((a) => a.id === source) ?? accounts[0];
  const parsedAmount = parsePesos(amountText);
  const parsedClabe = checkClabe(clabe);

  function validate(): Errors {
    const e: Errors = {};
    if (!account) e.source = 'Elige la cuenta de origen.';
    if (!parsedClabe.ok) e.clabe = parsedClabe.reason;
    else if (!parsedClabe.clabe.startsWith('999')) e.clabe = 'Por ahora solo puedes transferir a cuentas Ámbar (su CLABE empieza con 999).';
    else if (account && parsedClabe.clabe === account.clabe) e.clabe = 'La CLABE de destino es la de tu cuenta de origen.';
    if (!parsedAmount.ok) e.amount = parsedAmount.reason;
    else if (parsedAmount.centavos > MAX_TRANSFER_CENTAVOS) e.amount = `El máximo por transferencia es ${formatMXN(MAX_TRANSFER_CENTAVOS)}.`;
    else if (account && parsedAmount.centavos > account.balance) e.amount = `Tu saldo disponible es ${formatMXN(account.balance)}.`;
    if (concept.trim().length === 0) e.concept = 'Escribe un concepto, por ejemplo "Renta octubre".';
    return e;
  }

  function onContinue(ev: React.FormEvent) {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    // Una llave nueva por cada resumen confirmado; los reintentos de este resumen la reutilizan.
    setIdempotencyKey(crypto.randomUUID());
    setStep('review');
  }

  // Respuesta del servidor.
  useEffect(() => {
    if (result.status === 'ok') setStep('done');
    if (result.status === 'error' && result.field) {
      setErrors({ [result.field]: result.fieldMessage ?? result.message });
      setStep('capture');
      requestAnimationFrame(() => summaryRef.current?.focus());
    }
  }, [result]);

  // Al cambiar de paso, el foco va al título para que el lector de pantalla anuncie dónde está.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const errorList = Object.entries(errors) as Array<[TransferField, string]>;
  const describedBy = (f: TransferField, hint?: string) => [hint, errors[f] ? `${f}-error` : ''].filter(Boolean).join(' ') || undefined;

  return (
    <section className="section" aria-labelledby="transfer-title">
      <ol className="steps" aria-label="Pasos de la transferencia">
        <li aria-current={step === 'capture' ? 'step' : undefined}>1. Datos</li>
        <li aria-current={step === 'review' ? 'step' : undefined}>2. Confirmación</li>
        <li aria-current={step === 'done' ? 'step' : undefined}>3. Comprobante</li>
      </ol>

      {step === 'capture' && (
        <form className="panel form" onSubmit={onContinue} noValidate>
          <h1 id="transfer-title" ref={headingRef} tabIndex={-1}>
            Transferir
          </h1>

          {errorList.length > 0 && (
            <div className="alert" role="alert" tabIndex={-1} ref={summaryRef}>
              <strong>{errorList.length === 1 ? 'Revisa un dato:' : `Revisa ${errorList.length} datos:`}</strong>
              <ul>
                {errorList.map(([f, msg]) => (
                  <li key={f}>
                    <a href={`#${f}`}>{LABELS[f]}</a>: {msg}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="field">
            <label htmlFor="source">{LABELS.source}</label>
            <select
              id="source"
              className="select"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              aria-invalid={errors.source ? true : undefined}
              aria-describedby={describedBy('source')}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  Débito ••{lastFour(a.clabe)} · disponible {formatMXN(a.balance)}
                </option>
              ))}
            </select>
            {errors.source && <p id="source-error" className="error">{errors.source}</p>}
          </div>

          <div className="field">
            <label htmlFor="clabe">{LABELS.clabe}</label>
            <input
              id="clabe"
              className="input mono"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              maxLength={23}
              value={clabe}
              onChange={(e) => setClabe(e.target.value)}
              onBlur={() => parsedClabe.ok && setClabe(formatClabe(parsedClabe.clabe))}
              aria-invalid={errors.clabe ? true : undefined}
              aria-describedby={describedBy('clabe', 'clabe-hint')}
            />
            <p id="clabe-hint" className="hint">
              18 dígitos. Revisamos el dígito verificador antes de enviar.
            </p>
            {errors.clabe && <p id="clabe-error" className="error">{errors.clabe}</p>}
          </div>

          <div className="field">
            <label htmlFor="amount">{LABELS.amount}</label>
            <div className="money">
              <input
                id="amount"
                className="input"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                aria-invalid={errors.amount ? true : undefined}
                aria-describedby={describedBy('amount', 'amount-hint')}
              />
            </div>
            <p id="amount-hint" className="hint">
              Disponible: {account ? formatMXN(account.balance) : '—'}
            </p>
            {errors.amount && <p id="amount-error" className="error">{errors.amount}</p>}
          </div>

          <div className="field">
            <label htmlFor="concept">{LABELS.concept}</label>
            <input
              id="concept"
              className="input"
              maxLength={40}
              autoComplete="off"
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              aria-invalid={errors.concept ? true : undefined}
              aria-describedby={describedBy('concept', 'concept-count')}
            />
            <span id="concept-count" className="counter">
              {concept.length}/40
            </span>
            {errors.concept && <p id="concept-error" className="error">{errors.concept}</p>}
          </div>

          <button type="submit" className="btn btn-primary btn-block">
            Continuar
          </button>
        </form>
      )}

      {step === 'review' && parsedAmount.ok && parsedClabe.ok && (
        <form className="panel form" action={formAction}>
          <h1 id="transfer-title" ref={headingRef} tabIndex={-1}>
            Confirma tu transferencia
          </h1>
          {result.status === 'error' && !result.field && (
            <p className="alert" role="alert">
              {result.message}
            </p>
          )}
          <div className="receipt-amount">
            <Amount centavos={parsedAmount.centavos} className="amount-xl" />
          </div>
          <dl className="summary">
            <div>
              <dt>Desde</dt>
              <dd>Débito ••{lastFour(account.clabe)}</dd>
            </div>
            <div>
              <dt>Hacia CLABE</dt>
              <dd className="mono">{formatClabe(parsedClabe.clabe)}</dd>
            </div>
            <div>
              <dt>Concepto</dt>
              <dd>{concept.trim()}</dd>
            </div>
            <div>
              <dt>Saldo después</dt>
              <dd>{formatMXN(account.balance - parsedAmount.centavos)}</dd>
            </div>
          </dl>
          <input type="hidden" name="source" value={account.id} />
          <input type="hidden" name="clabe" value={parsedClabe.clabe} />
          <input type="hidden" name="amount" value={parsedAmount.centavos} />
          <input type="hidden" name="concept" value={concept.trim()} />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey ?? ''} />
          <div className="actions">
            <button type="button" className="btn" onClick={() => setStep('capture')} disabled={pending}>
              Corregir datos
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending} aria-disabled={pending}>
              {pending ? 'Enviando…' : 'Confirmar y enviar'}
            </button>
          </div>
          <p className="hint" aria-live="polite">
            {pending ? 'Enviando tu transferencia. No cierres esta página.' : ''}
          </p>
        </form>
      )}

      {step === 'done' && result.status === 'ok' && (
        <div className="panel form">
          <CheckIcon />
          <h1 id="transfer-title" ref={headingRef} tabIndex={-1} className="receipt-amount">
            Transferencia enviada
          </h1>
          <div className="receipt-amount">
            <Amount centavos={result.receipt.amount} className="amount-xl" />
          </div>
          <dl className="summary">
            <div>
              <dt>Folio</dt>
              <dd className="mono">{result.receipt.id}</dd>
            </div>
            <div>
              <dt>Fecha</dt>
              <dd>{dateTime.format(new Date(result.receipt.createdAt))}</dd>
            </div>
            <div>
              <dt>Hacia CLABE</dt>
              <dd className="mono">{formatClabe(result.receipt.destinationClabe)}</dd>
            </div>
            <div>
              <dt>Concepto</dt>
              <dd>{result.receipt.concept}</dd>
            </div>
          </dl>
          <div className="actions">
            <button type="button" className="btn" onClick={onRestart}>
              Hacer otra transferencia
            </button>
            <Link className="btn btn-primary" href={`/cuentas/${result.receipt.sourceId}`}>
              Ver movimientos
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
