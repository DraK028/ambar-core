terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.95"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

# ---------------------------------------------------------------------------
# User pool: clientes de Ámbar
# ---------------------------------------------------------------------------
resource "aws_cognito_user_pool" "this" {
  name                     = "${var.name}-customers"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  deletion_protection      = var.deletion_protection ? "ACTIVE" : "INACTIVE"

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 3
  }

  # TOTP con app autenticadora. En la app móvil, el segundo factor diario es la
  # llave biométrica del dispositivo (fase 3); el TOTP sirve para enrolar dispositivos.
  mfa_configuration = var.mfa_configuration
  software_token_mfa_configuration {
    enabled = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = !var.allow_self_signup
  }

  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }
}

resource "random_id" "domain" {
  byte_length = 3
}

# Dominio de la página de inicio de sesión administrada por Cognito (OAuth2).
resource "aws_cognito_user_pool_domain" "this" {
  domain       = "${var.name}-${random_id.domain.hex}"
  user_pool_id = aws_cognito_user_pool.this.id
}

resource "aws_cognito_user_group" "operators" {
  name         = "operators"
  user_pool_id = aws_cognito_user_pool.this.id
  description  = "Personal de operación: puede consultar y reversar asientos (ledger.admin)"
}

# ---------------------------------------------------------------------------
# Resource server: los scopes que valida el Ledger y API Gateway
# ---------------------------------------------------------------------------
resource "aws_cognito_resource_server" "api" {
  identifier   = "ambar-api"
  name         = "Ámbar Core API"
  user_pool_id = aws_cognito_user_pool.this.id

  scope {
    scope_name        = "accounts.read"
    scope_description = "Consultar cuentas y movimientos propios"
  }
  scope {
    scope_name        = "accounts.write"
    scope_description = "Abrir cuentas"
  }
  scope {
    scope_name        = "transfers.write"
    scope_description = "Enviar transferencias"
  }
  scope {
    scope_name        = "devices.write"
    scope_description = "Registrar y revocar la llave biométrica de un teléfono"
  }
  scope {
    scope_name        = "ledger.admin"
    scope_description = "Operación del ledger (además requiere el grupo operators)"
  }
  scope {
    scope_name        = "qa.write"
    scope_description = "Simular movimientos en entornos no productivos"
  }
  scope {
    scope_name        = "assistant.chat"
    scope_description = "Conversar con el asistente financiero (solo lectura)"
  }
  scope {
    scope_name        = "internal.notify"
    scope_description = "Automatización: crear avisos para clientes"
  }
  scope {
    scope_name        = "internal.fraud"
    scope_description = "Automatización: abrir casos de posible fraude"
  }
  scope {
    scope_name        = "internal.reconcile"
    scope_description = "Automatización: consultar la conciliación"
  }
}

locals {
  scope = { for s in aws_cognito_resource_server.api.scope_identifiers : trimprefix(s, "ambar-api/") => s }

  customer_scopes = [
    "openid", "email",
    local.scope["accounts.read"],
    local.scope["accounts.write"],
    local.scope["transfers.write"],
    local.scope["assistant.chat"],
  ]

  # Tokens cortos: access e ID de 10 minutos, refresh de 30 días revocable.
  token_validity = {
    access_minutes = 10
    id_minutes     = 10
    refresh_days   = 30
  }
}

# ---------------------------------------------------------------------------
# App clients
# ---------------------------------------------------------------------------

# BFF de Next.js (fase 2b): cliente confidencial, el secreto vive en el servidor.
resource "aws_cognito_user_pool_client" "web" {
  name                                 = "${var.name}-web-bff"
  user_pool_id                         = aws_cognito_user_pool.this.id
  generate_secret                      = true
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = local.customer_scopes
  callback_urls                        = var.web_callback_urls
  logout_urls                          = var.web_logout_urls
  supported_identity_providers         = ["COGNITO"]
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  access_token_validity                = local.token_validity.access_minutes
  id_token_validity                    = local.token_validity.id_minutes
  refresh_token_validity               = local.token_validity.refresh_days

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

# App móvil (fase 3): cliente público con PKCE, sin secreto. Además puede registrar
# la llave del dispositivo (devices.write) para el desbloqueo y el step-up biométrico.
resource "aws_cognito_user_pool_client" "mobile" {
  name                                 = "${var.name}-mobile"
  user_pool_id                         = aws_cognito_user_pool.this.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = concat(local.customer_scopes, [local.scope["devices.write"]])
  callback_urls                        = ["ambar://auth/callback"]
  logout_urls                          = ["ambar://auth/logout"]
  supported_identity_providers         = ["COGNITO"]
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  access_token_validity                = local.token_validity.access_minutes
  id_token_validity                    = local.token_validity.id_minutes
  refresh_token_validity               = local.token_validity.refresh_days

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

# Consola de operación: pide ledger.admin; el Ledger además exige el grupo operators.
resource "aws_cognito_user_pool_client" "ops" {
  name                                 = "${var.name}-ops"
  user_pool_id                         = aws_cognito_user_pool.this.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", local.scope["ledger.admin"], local.scope["accounts.read"]]
  callback_urls                        = var.cli_callback_urls
  supported_identity_providers         = ["COGNITO"]
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  access_token_validity                = 10
  id_token_validity                    = 10
  refresh_token_validity               = 8

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "hours"
  }
}

# Cliente de línea de comandos para desarrollo (tools/cognito-login.mjs): público con PKCE
# y callback en localhost. Solo existe fuera de producción.
resource "aws_cognito_user_pool_client" "cli" {
  count = var.enable_dev_clients ? 1 : 0

  name                                 = "${var.name}-cli"
  user_pool_id                         = aws_cognito_user_pool.this.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = local.customer_scopes
  callback_urls                        = var.cli_callback_urls
  supported_identity_providers         = ["COGNITO"]
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  access_token_validity                = 60
  id_token_validity                    = 60
  refresh_token_validity               = 1

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

# Automatización de QA (máquina a máquina): client credentials con qa.write.
resource "aws_cognito_user_pool_client" "qa" {
  count = var.enable_dev_clients ? 1 : 0

  name                                 = "${var.name}-qa-automation"
  user_pool_id                         = aws_cognito_user_pool.this.id
  generate_secret                      = true
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["client_credentials"]
  allowed_oauth_scopes                 = [local.scope["qa.write"]]
  supported_identity_providers         = ["COGNITO"]
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH"]
  access_token_validity                = 60

  token_validity_units {
    access_token = "minutes"
  }
}

# Automatización (n8n): client credentials con los scopes internos. El Ledger además exige
# que el client_id esté en INTERNAL_CLIENT_IDS, y API Gateway no publica /v1/internal.
resource "aws_cognito_user_pool_client" "automation" {
  name                                 = "${var.name}-automation"
  user_pool_id                         = aws_cognito_user_pool.this.id
  generate_secret                      = true
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["client_credentials"]
  allowed_oauth_scopes                 = [local.scope["internal.notify"], local.scope["internal.fraud"], local.scope["internal.reconcile"]]
  supported_identity_providers         = ["COGNITO"]
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH"]
  access_token_validity                = 60

  token_validity_units {
    access_token = "minutes"
  }
}
