'use client';

import { useState } from 'react';

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <>
      <button type="button" className="btn btn-quiet" onClick={copy} aria-label={label}>
        {copied ? 'Copiada' : 'Copiar'}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? 'CLABE copiada al portapapeles' : ''}
      </span>
    </>
  );
}
