-- 005 · Publicación de eventos, avisos al cliente y casos de fraude
--
-- El outbox pasa a ser una cola con reintentos: el relay toma lotes con
-- FOR UPDATE SKIP LOCKED (varias réplicas sin publicar dos veces el mismo evento),
-- reintenta con backoff exponencial y aparta como "muerto" lo que falla demasiado.

ALTER TABLE ledger.outbox
  ADD COLUMN attempts         INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ADD COLUMN next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN last_error       TEXT,
  ADD COLUMN dead_at          TIMESTAMPTZ,
  ADD CONSTRAINT outbox_published_or_dead CHECK (published_at IS NULL OR dead_at IS NULL);

DROP INDEX ledger.outbox_pending_idx;
CREATE INDEX outbox_due_idx ON ledger.outbox (next_attempt_at, created_at)
  WHERE published_at IS NULL AND dead_at IS NULL;

-- Despierta al relay en cuanto se confirma una transacción con eventos (LISTEN ledger_outbox).
-- Postgres agrupa notificaciones idénticas de una misma transacción: una sola señal por COMMIT.
CREATE FUNCTION ledger.notify_outbox() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('ledger_outbox', '');
  RETURN NULL;
END $$;

CREATE TRIGGER outbox_notify
  AFTER INSERT ON ledger.outbox
  FOR EACH STATEMENT EXECUTE FUNCTION ledger.notify_outbox();

-- ---------------------------------------------------------------------------
-- Avisos del cliente (bandeja de la app). Los redacta n8n a partir de eventos;
-- (source_event_id, owner_id, kind) es único: si n8n reintenta, no se duplican.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS customer;

CREATE TABLE customer.notifications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN (
                     'WELCOME', 'TRANSFER_SENT', 'TRANSFER_RECEIVED', 'DEPOSIT_RECEIVED',
                     'FRAUD_CHECK', 'ACCOUNT_FROZEN', 'SECURITY')),
  title            TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  body             TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 280),
  data             JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_event_id  UUID NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at          TIMESTAMPTZ,
  CONSTRAINT notifications_once_per_event UNIQUE (source_event_id, owner_id, kind)
);

CREATE INDEX notifications_owner_idx ON customer.notifications (owner_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Casos de fraude: una transferencia con riesgo alto se le pregunta al cliente.
-- Si responde que no la reconoce, la cuenta de origen se congela en la misma transacción.
-- ---------------------------------------------------------------------------
CREATE TABLE customer.fraud_cases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id     UUID NOT NULL UNIQUE REFERENCES ledger.journal_entries (id),
  account_id   UUID NOT NULL REFERENCES ledger.accounts (id),
  owner_id     TEXT NOT NULL,
  score        SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
  reasons      TEXT[] NOT NULL,
  status       TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RECOGNIZED', 'NOT_RECOGNIZED')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  CONSTRAINT fraud_cases_resolved_has_date CHECK ((status = 'OPEN') = (resolved_at IS NULL))
);

CREATE INDEX fraud_cases_owner_idx ON customer.fraud_cases (owner_id, created_at DESC);

-- Token de Expo Push por dispositivo. Se borra al revocar el dispositivo.
ALTER TABLE identity.devices
  ADD COLUMN push_token TEXT CHECK (push_token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,128}\]$');

GRANT USAGE ON SCHEMA customer TO app_ledger;
GRANT SELECT, INSERT, UPDATE ON customer.notifications, customer.fraud_cases TO app_ledger;
REVOKE DELETE, TRUNCATE ON customer.notifications, customer.fraud_cases FROM app_ledger;

-- ---------------------------------------------------------------------------
-- Rol del relay: solo lee y marca eventos del outbox. No ve saldos, asientos ni avisos.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_relay') THEN
    CREATE ROLE app_relay NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ambar_relay') THEN
    CREATE ROLE ambar_relay LOGIN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rds_iam') THEN
    GRANT rds_iam TO ambar_relay;
  END IF;
END $$;

GRANT USAGE ON SCHEMA ledger TO app_relay;
GRANT SELECT ON ledger.outbox TO app_relay;
GRANT UPDATE (attempts, next_attempt_at, last_error, dead_at, published_at) ON ledger.outbox TO app_relay;
GRANT app_relay TO ambar_relay;
