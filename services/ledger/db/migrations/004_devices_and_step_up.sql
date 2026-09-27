-- 004 · Dispositivos de la app móvil y retos de confirmación (step-up)
--
-- Cada dispositivo registra una llave pública ECDSA P-256 generada en su hardware
-- (Android Keystore / Secure Enclave), protegida con biometría. La llave privada
-- nunca sale del teléfono: el servidor solo verifica firmas.

CREATE SCHEMA IF NOT EXISTS identity;

CREATE TABLE identity.devices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         TEXT NOT NULL,
  platform         TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  name             TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  public_key       BYTEA NOT NULL,                 -- SubjectPublicKeyInfo DER
  key_fingerprint  TEXT NOT NULL UNIQUE,           -- sha256 del SPKI: una llave no se registra dos veces
  status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at     TIMESTAMPTZ,
  revoked_at       TIMESTAMPTZ,
  CONSTRAINT devices_revoked_has_date CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);

CREATE INDEX devices_owner_active_idx ON identity.devices (owner_id) WHERE status = 'ACTIVE';

-- Reto de un solo uso, ligado al usuario, al dispositivo y al hash exacto de la operación.
CREATE TABLE identity.step_up_challenges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        TEXT NOT NULL,
  device_id       UUID NOT NULL REFERENCES identity.devices (id),
  nonce           TEXT NOT NULL,
  operation_hash  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  CONSTRAINT challenges_expire_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX step_up_challenges_device_idx ON identity.step_up_challenges (device_id);

-- Beneficiarios conocidos: se consulta si el usuario ya transfirió antes a esa cuenta.
CREATE INDEX journal_entries_beneficiary_idx
  ON ledger.journal_entries ((metadata ->> 'initiated_by'), (metadata ->> 'destination_account_id'))
  WHERE kind = 'TRANSFER';

GRANT USAGE ON SCHEMA identity TO app_ledger;
GRANT SELECT, INSERT, UPDATE ON identity.devices, identity.step_up_challenges TO app_ledger;
REVOKE DELETE, TRUNCATE ON identity.devices, identity.step_up_challenges FROM app_ledger;
