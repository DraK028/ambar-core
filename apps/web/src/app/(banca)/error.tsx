'use client';

export default function BancaError({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="panel form" role="alert">
      <h1>No pudimos cargar esta información</h1>
      <p className="muted">El servicio no respondió a tiempo. Tu dinero no se movió. Intenta de nuevo en unos segundos.</p>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={reset}>
          Reintentar
        </button>
      </div>
    </section>
  );
}
