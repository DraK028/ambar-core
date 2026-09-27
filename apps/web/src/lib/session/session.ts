import 'server-only';
import { cookies } from 'next/headers';
import { config, type WebConfig } from '../config';
import { randomToken, seal, unseal } from '../crypto';
import { mintLocalToken, refreshTokens, type Identity, type TokenSet } from '../auth/oidc';
import { idleExpiresAt, needsRefresh, sessionState, shouldTouch } from './policy';
import { DynamoSessionStore, MemorySessionStore, type SessionRecord, type SessionStore } from './store';

interface Tokens {
  accessToken: string;
  refreshToken: string | null;
}

export interface ActiveSession {
  id: string;
  sub: string;
  email: string | null;
  accessToken: string;
  /** Epoch ms en que vence por inactividad; la interfaz avisa 60 s antes. */
  idleExpiresAt: number;
}

const globalStore = globalThis as unknown as { __ambarSessions?: SessionStore };

function store(c: WebConfig): SessionStore {
  globalStore.__ambarSessions ??=
    c.SESSION_STORE === 'dynamodb' ? new DynamoSessionStore(c.SESSIONS_TABLE!, c.AWS_REGION!) : new MemorySessionStore();
  return globalStore.__ambarSessions;
}

export function sessionCookieName(c: WebConfig): string {
  // El prefijo __Host- obliga a Secure, Path=/ y sin Domain: la cookie no se comparte con subdominios.
  return c.secureCookies ? '__Host-ambar_sid' : 'ambar_sid';
}

function policy(c: WebConfig) {
  return { idleMs: c.SESSION_IDLE_MINUTES * 60_000 };
}

/** Crea la sesión tras un login exitoso y fija la cookie. Solo en Route Handlers o Server Actions. */
export async function createSession(identity: Identity, provider: SessionRecord['provider'], tokens: TokenSet): Promise<void> {
  const jar = await cookies();
  const c = config();

  // Contra fijación de sesión: si había una sesión anterior en este navegador, se elimina.
  const previous = jar.get(sessionCookieName(c))?.value;
  if (previous) await store(c).delete(previous);

  const now = Date.now();
  const record: SessionRecord = {
    id: randomToken(32),
    sub: identity.sub,
    email: identity.email,
    provider,
    sealedTokens: seal({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken } satisfies Tokens, c.SESSION_SECRET),
    accessExpiresAt: now + tokens.expiresIn * 1000,
    createdAt: now,
    lastSeenAt: now,
    absoluteExpiresAt: now + c.SESSION_ABSOLUTE_HOURS * 3_600_000,
  };
  await store(c).put(record);

  jar.set(sessionCookieName(c), record.id, {
    httpOnly: true,
    secure: c.secureCookies,
    sameSite: 'strict',
    path: '/',
    maxAge: c.SESSION_ABSOLUTE_HOURS * 3600,
  });
}

/**
 * Sesión vigente o null. Se puede llamar desde Server Components: no escribe cookies,
 * solo el almacén (renovar el access token o marcar actividad no cambia el id de sesión).
 */
export async function getSession(options: { touch?: boolean } = { touch: true }): Promise<ActiveSession | null> {
  const jar = await cookies(); // primero: marca la ruta como dinámica antes de leer la configuración
  const c = config();
  const id = jar.get(sessionCookieName(c))?.value;
  if (!id) return null;

  const s = store(c);
  const record = await s.get(id);
  if (!record) return null;

  const now = Date.now();
  if (sessionState(record, now, policy(c)) !== 'active') {
    await s.delete(id);
    return null;
  }

  const tokens = unseal<Tokens>(record.sealedTokens, c.SESSION_SECRET);
  if (!tokens) {
    await s.delete(id);
    return null;
  }

  let changed = false;
  if (needsRefresh(record, now)) {
    try {
      const fresh =
        record.provider === 'local'
          ? await mintLocalToken(c, record.sub)
          : tokens.refreshToken
            ? await refreshTokens(c, tokens.refreshToken)
            : null;
      if (!fresh) throw new Error('Sin refresh token');
      tokens.accessToken = fresh.accessToken;
      tokens.refreshToken = fresh.refreshToken ?? tokens.refreshToken;
      record.sealedTokens = seal(tokens, c.SESSION_SECRET);
      record.accessExpiresAt = now + fresh.expiresIn * 1000;
      changed = true;
    } catch {
      // Refresh revocado o vencido: la sesión termina y el usuario vuelve a iniciar sesión.
      await s.delete(id);
      return null;
    }
  }
  if (options.touch && shouldTouch(record, now)) {
    record.lastSeenAt = now;
    changed = true;
  }
  if (changed) await s.put(record);

  return {
    id: record.id,
    sub: record.sub,
    email: record.email,
    accessToken: tokens.accessToken,
    idleExpiresAt: idleExpiresAt(record, policy(c)),
  };
}

/** Marca actividad explícita (botón "Seguir conectado"). */
export async function keepAlive(): Promise<number | null> {
  const jar = await cookies();
  const c = config();
  const id = jar.get(sessionCookieName(c))?.value;
  if (!id) return null;
  const s = store(c);
  const record = await s.get(id);
  if (!record || sessionState(record, Date.now(), policy(c)) !== 'active') return null;
  record.lastSeenAt = Date.now();
  await s.put(record);
  return idleExpiresAt(record, policy(c));
}

/** Borra la sesión y devuelve el refresh token para revocarlo en Cognito. */
export async function destroySession(): Promise<{ provider: SessionRecord['provider']; refreshToken: string | null } | null> {
  const jar = await cookies();
  const c = config();
  const id = jar.get(sessionCookieName(c))?.value;
  jar.delete(sessionCookieName(c));
  if (!id) return null;
  const s = store(c);
  const record = await s.get(id);
  await s.delete(id);
  if (!record) return null;
  const tokens = unseal<Tokens>(record.sealedTokens, c.SESSION_SECRET);
  return { provider: record.provider, refreshToken: tokens?.refreshToken ?? null };
}
