-- 002 · Cuentas de sistema y rol de aplicación

-- Cuenta de liquidación con Banxico (activo). Los depósitos SPEI entrantes la debitan.
INSERT INTO ledger.accounts (code, kind, normal_side, allow_negative)
VALUES ('SPEI_SETTLEMENT', 'SYSTEM', 'DEBIT', TRUE)
ON CONFLICT (code) DO NOTHING;

-- Rol con el que corre el servicio. Sin UPDATE/DELETE sobre asientos y postings:
-- la restricción queda en permisos además de en los triggers.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ledger') THEN
    CREATE ROLE app_ledger NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA ledger TO app_ledger;
GRANT SELECT, INSERT ON ledger.journal_entries, ledger.postings TO app_ledger;
GRANT SELECT, INSERT, UPDATE ON ledger.accounts, ledger.outbox TO app_ledger;
GRANT SELECT ON ledger.balance_drift TO app_ledger;
GRANT USAGE ON SEQUENCE ledger.postings_id_seq, ledger.clabe_account_seq TO app_ledger;
REVOKE UPDATE, DELETE, TRUNCATE ON ledger.journal_entries, ledger.postings FROM app_ledger;
