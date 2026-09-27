import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';

export const LEDGER_URL = process.env.E2E_LEDGER_URL ?? 'http://localhost:3000';
const SECRET = process.env.LOCAL_JWT_SECRET ?? 'e2e-local-secret-with-at-least-32-characters';

async function token(sub: string, scopes: string) {
  return new SignJWT({ scope: scopes.split(' ').map((s) => `ambar-api/${s}`).join(' '), token_use: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer('ambar-local')
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(SECRET));
}

async function api<T>(path: string, sub: string, scopes: string, body?: unknown): Promise<T> {
  const res = await fetch(`${LEDGER_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token(sub, scopes)}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export interface Customer {
  sub: string;
  account: { id: string; clabe: string; balance: number };
}

/** Cliente de prueba aislado: usuario único, cuenta nueva y saldo inicial vía el endpoint de QA del core. */
export async function customer(label: string, pesos = 0): Promise<Customer> {
  const sub = `e2e-${label}-${randomUUID().slice(0, 8)}`;
  const account = await api<Customer['account']>('/v1/accounts', sub, 'accounts.write');
  if (pesos > 0) {
    await api('/v1/qa/deposits', 'qa-bot', 'qa.write', { account_id: account.id, amount: pesos * 100, concept: 'Depósito de prueba' });
  }
  return { sub, account: { ...account, balance: pesos * 100 } };
}

export async function login(page: Page, sub: string) {
  await page.goto('/entrar');
  await page.getByLabel('Otro usuario de prueba').fill(sub);
  await page.getByRole('button', { name: 'Entrar como este usuario' }).click();
  await expect(page).toHaveURL(/\/inicio$/);
}

/** WCAG 2.2 AA con axe-core. Falla con la lista de violaciones para que el error sea accionable. */
export async function expectAccessible(page: Page, context: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(summary, `Violaciones de accesibilidad en ${context}`).toEqual([]);
}

/** Una CLABE Ámbar con verificador válido que no pertenece a ninguna cuenta. */
export const UNUSED_CLABE = '999180999999999995';
