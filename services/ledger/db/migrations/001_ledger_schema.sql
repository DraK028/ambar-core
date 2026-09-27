-- 001 · Esquema del ledger de doble partida
--
-- Convención de signos en ledger.postings.amount (centavos):
--   débito  > 0
--   crédito < 0
-- La suma de los postings de un asiento siempre es 0.
--
-- Las cuentas de clientes son pasivos del banco (saldo normal acreedor):
--   saldo del cliente = -SUM(amount)
-- Las cuentas de liquidación (p. ej. SPEI/Banxico) son activos (saldo normal deudor):
--   saldo = SUM(amount)

CREATE SCHEMA IF NOT EXISTS ledger;

CREATE TABLE ledger.accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        TEXT,                        -- "sub" del usuario en Cognito; NULL en cuentas de sistema
  code            TEXT UNIQUE,                 -- nombre estable de cuentas de sistema
  clabe           CHAR(18) UNIQUE,
  kind            TEXT NOT NULL CHECK (kind IN ('CUSTOMER', 'SYSTEM')),
  normal_side     TEXT NOT NULL CHECK (normal_side IN ('DEBIT', 'CREDIT')),
  currency        CHAR(3) NOT NULL DEFAULT 'MXN',
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'FROZEN', 'CLOSED')),
  allow_negative  BOOLEAN NOT NULL DEFAULT FALSE,
  balance         BIGINT NOT NULL DEFAULT 0,   -- saldo en su lado normal, mantenido en la misma transacción que los postings
  version         BIGINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT accounts_balance_non_negative CHECK (allow_negative OR balance >= 0),
  CONSTRAINT accounts_customer_has_owner CHECK (kind <> 'CUSTOMER' OR (owner_id IS NOT NULL AND clabe IS NOT NULL)),
  CONSTRAINT accounts_system_has_code CHECK (kind <> 'SYSTEM' OR code IS NOT NULL)
);

CREATE INDEX accounts_owner_idx ON ledger.accounts (owner_id) WHERE owner_id IS NOT NULL;

-- Consecutivo para los 11 dígitos de número de cuenta dentro de la CLABE.
CREATE SEQUENCE ledger.clabe_account_seq START 1 MAXVALUE 99999999999;

CREATE TABLE ledger.journal_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key  TEXT NOT NULL UNIQUE,       -- "<scope>:<Idempotency-Key>" para aislar clientes
  request_hash     TEXT NOT NULL,              -- sha256 del cuerpo canónico; detecta reuso de llave con otro cuerpo
  kind             TEXT NOT NULL CHECK (kind IN ('TRANSFER', 'DEPOSIT', 'REVERSAL')),
  description      TEXT NOT NULL,
  reverses_id      UUID UNIQUE REFERENCES ledger.journal_entries (id),  -- UNIQUE: un asiento solo se reversa una vez
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT journal_entries_reversal_kind CHECK ((kind = 'REVERSAL') = (reverses_id IS NOT NULL))
);

CREATE TABLE ledger.postings (
  id          BIGSERIAL PRIMARY KEY,
  entry_id    UUID NOT NULL REFERENCES ledger.journal_entries (id),
  account_id  UUID NOT NULL REFERENCES ledger.accounts (id),
  amount      BIGINT NOT NULL CHECK (amount <> 0),
  currency    CHAR(3) NOT NULL DEFAULT 'MXN',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX postings_entry_idx ON ledger.postings (entry_id);
CREATE INDEX postings_account_idx ON ledger.postings (account_id, id DESC);

-- Outbox transaccional: el evento se escribe en la misma transacción que el asiento.
-- Un relay (fase 4) lo publica en EventBridge y marca published_at.
CREATE TABLE ledger.outbox (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id  UUID NOT NULL,
  event_type    TEXT NOT NULL,
  payload       JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at  TIMESTAMPTZ
);

CREATE INDEX outbox_pending_idx ON ledger.outbox (created_at) WHERE published_at IS NULL;

-- ---------------------------------------------------------------------------
-- Invariante 1: cada asiento cuadra (suma 0) y tiene al menos dos postings.
-- Triggers diferidos: se evalúan al hacer COMMIT, cuando ya están todos los postings.
-- ---------------------------------------------------------------------------
CREATE FUNCTION ledger.assert_entry_balanced(p_entry_id UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_total BIGINT;
  v_count INT;
  v_currencies INT;
BEGIN
  SELECT COALESCE(SUM(amount), 0), COUNT(*), COUNT(DISTINCT currency)
    INTO v_total, v_count, v_currencies
    FROM ledger.postings
   WHERE entry_id = p_entry_id;

  IF v_count < 2 OR v_total <> 0 OR v_currencies > 1 THEN
    RAISE EXCEPTION 'Asiento % descuadrado: suma=%, postings=%, monedas=%',
      p_entry_id, v_total, v_count, v_currencies
      USING ERRCODE = 'check_violation', CONSTRAINT = 'entry_must_balance';
  END IF;
END $$;

CREATE FUNCTION ledger.trg_posting_balanced() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger.assert_entry_balanced(NEW.entry_id);
  RETURN NULL;
END $$;

CREATE FUNCTION ledger.trg_entry_balanced() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger.assert_entry_balanced(NEW.id);
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER postings_must_balance
  AFTER INSERT ON ledger.postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger.trg_posting_balanced();

CREATE CONSTRAINT TRIGGER entries_must_have_postings
  AFTER INSERT ON ledger.journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger.trg_entry_balanced();

-- ---------------------------------------------------------------------------
-- Invariante 2: el ledger es de solo inserción. Una corrección es un reverso.
-- ---------------------------------------------------------------------------
CREATE FUNCTION ledger.trg_append_only() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es de solo inserción: registra un asiento de reverso', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER postings_append_only
  BEFORE UPDATE OR DELETE ON ledger.postings
  FOR EACH ROW EXECUTE FUNCTION ledger.trg_append_only();

CREATE TRIGGER journal_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger.journal_entries
  FOR EACH ROW EXECUTE FUNCTION ledger.trg_append_only();

-- ---------------------------------------------------------------------------
-- Vista de conciliación: saldo guardado contra saldo derivado de los postings.
-- SUM(bigint) devuelve numeric; se regresa a bigint para compararlo y exponerlo.
-- ---------------------------------------------------------------------------
CREATE VIEW ledger.balance_drift AS
SELECT a.id,
       a.code,
       a.clabe,
       a.balance AS stored_balance,
       (CASE a.normal_side WHEN 'CREDIT' THEN -COALESCE(SUM(p.amount), 0)
                           ELSE COALESCE(SUM(p.amount), 0) END)::bigint AS derived_balance
  FROM ledger.accounts a
  LEFT JOIN ledger.postings p ON p.account_id = a.id
 GROUP BY a.id
HAVING a.balance <> CASE a.normal_side WHEN 'CREDIT' THEN -COALESCE(SUM(p.amount), 0)
                                       ELSE COALESCE(SUM(p.amount), 0) END;
