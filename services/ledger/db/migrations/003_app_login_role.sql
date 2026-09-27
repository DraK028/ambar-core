-- 003 · Usuario de la aplicación
--
-- El servicio no se conecta con el usuario maestro. Usa ambar_app, que solo hereda
-- los permisos de app_ledger (sin UPDATE/DELETE sobre asientos y postings).
--
-- En Aurora, ambar_app entra con un token IAM de 15 minutos (rol rds_iam):
-- no existe una contraseña que guardar, rotar o filtrar.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ambar_app') THEN
    CREATE ROLE ambar_app LOGIN;
  END IF;
  -- rds_iam solo existe en RDS/Aurora; en local y en pruebas este paso se omite.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rds_iam') THEN
    GRANT rds_iam TO ambar_app;
  END IF;
END $$;

GRANT app_ledger TO ambar_app;
