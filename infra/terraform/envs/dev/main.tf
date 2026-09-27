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
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }

  # Estado remoto en S3 con bloqueo nativo (Terraform 1.10+). El bucket se pasa al hacer init:
  #   terraform init -backend-config="bucket=<tu-bucket-de-estado>"
  backend "s3" {
    key          = "ambar/dev/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "ambar"
      Environment = "dev"
      ManagedBy   = "terraform"
      Owner       = var.owner
    }
  }
}

locals {
  name = "ambar-dev"
}

module "network" {
  source = "../../modules/network"

  name                       = local.name
  cidr                       = "10.20.0.0/16"
  single_nat_gateway         = true  # dev: un NAT para ahorrar
  enable_interface_endpoints = false # dev: se activan en staging y prod
}

# Security group de las tareas de ECS del core. En la fase 1 aún no hay tareas;
# se crea ahora para que Aurora ya tenga su regla de entrada definida.
resource "aws_security_group" "core_services" {
  name        = "${local.name}-core-services"
  description = "Tareas de ECS Fargate del core bancario"
  vpc_id      = module.network.vpc_id

  egress {
    description = "Salida a servicios de AWS y a Aurora"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

module "aurora" {
  source = "../../modules/aurora"

  name                       = local.name
  vpc_id                     = module.network.vpc_id
  db_subnet_group_name       = module.network.database_subnet_group_name
  allowed_security_group_ids = [aws_security_group.core_services.id]

  min_acu               = 0 # se pausa sin conexiones: cuesta casi nada fuera del horario de trabajo
  max_acu               = 2
  instance_count        = 1
  backup_retention_days = 1
  deletion_protection   = false
}

module "github_oidc" {
  source = "../../modules/github-oidc"

  name              = local.name
  github_repository = var.github_repository
}

# ---------------------------------------------------------------------------
# Dominio propio (opcional): certificado para web, API y NLB interno
# ---------------------------------------------------------------------------
module "domain" {
  count  = var.domain_name == "" ? 0 : 1
  source = "../../modules/domain"

  domain_name = var.domain_name
  zone_id     = var.route53_zone_id
}

locals {
  domain = one(module.domain[*])
}

# ---------------------------------------------------------------------------
# Fase 2a: identidad, cómputo y borde
# ---------------------------------------------------------------------------
module "cognito" {
  source = "../../modules/cognito"

  name                = local.name
  deletion_protection = false
  mfa_configuration   = "OPTIONAL"
  enable_dev_clients  = true

  # La banca web en AWS y la de tu máquina (npm run dev) pueden iniciar sesión.
  web_callback_urls = ["${module.web.app_url}/api/auth/callback", "http://localhost:3001/api/auth/callback"]
  web_logout_urls   = ["${module.web.app_url}/entrar", "http://localhost:3001/entrar"]
}

module "ledger" {
  source = "../../modules/ecs-ledger"

  name                   = local.name
  app_env                = "dev"
  vpc_id                 = module.network.vpc_id
  vpc_cidr               = module.network.vpc_cidr
  private_subnet_ids     = module.network.private_subnet_ids
  task_security_group_id = aws_security_group.core_services.id

  db_host                = module.aurora.cluster_endpoint
  db_cluster_resource_id = module.aurora.cluster_resource_id
  db_master_secret_arn   = module.aurora.master_secret_arn
  db_kms_key_arn         = module.aurora.kms_key_arn

  cognito_issuer      = module.cognito.issuer
  cognito_client_ids  = module.cognito.all_client_ids
  enable_qa_endpoints = true
  step_up_client_ids  = [module.cognito.client_ids.mobile]
  internal_client_ids = [module.cognito.automation_client_id]

  # Fase 4: el relay publica el outbox en EventBridge.
  event_bus_name = module.events.bus_name
  event_bus_arn  = module.events.bus_arn

  desired_count       = 1
  use_spot            = true # dev: más barato; ECS reemplaza la tarea si AWS la interrumpe
  tls_certificate_arn = try(local.domain.certificate_arn, null)
}

module "api" {
  source = "../../modules/api-gateway"

  name          = local.name
  stage_name    = "dev"
  nlb_arn       = module.ledger.nlb_arn
  nlb_dns_name  = module.ledger.nlb_dns_name
  user_pool_arn = module.cognito.user_pool_arn
  api_scopes    = module.cognito.public_scope_identifiers # los internal.* no entran por el gateway

  enable_waf          = var.enable_waf
  manage_account_role = var.manage_apigw_account_role

  backend_tls_hostname = try(local.domain.internal_host, null)
  api_domain_name      = try(local.domain.api_domain, null)

  # Fase 5: /v1/assistant/* hacia el asistente (otro puerto del NLB).
  enable_assistant = true
  assistant_scopes = [for s in module.cognito.scope_identifiers : s if endswith(s, "/assistant.chat")]
  certificate_arn  = try(local.domain.certificate_arn, null)
  zone_id          = try(local.domain.zone_id, null)
}

# ---------------------------------------------------------------------------
# Fase 2b: banca web
# ---------------------------------------------------------------------------
module "web" {
  source = "../../modules/web-app"

  name               = local.name
  app_env            = "dev"
  vpc_id             = module.network.vpc_id
  vpc_cidr           = module.network.vpc_cidr
  public_subnet_ids  = module.network.public_subnet_ids
  private_subnet_ids = module.network.private_subnet_ids
  cluster_arn        = module.ledger.cluster_arn

  ledger_api_url        = module.api.invoke_url
  cognito_domain        = module.cognito.hosted_domain
  cognito_client_id     = module.cognito.client_ids.web
  cognito_client_secret = module.cognito.web_client_secret
  cognito_issuer        = module.cognito.issuer

  domain_name     = try(local.domain.web_domain, null)
  certificate_arn = try(local.domain.certificate_arn, null)
  zone_id         = try(local.domain.zone_id, null)

  desired_count = 1
  use_spot      = true
}

# ---------------------------------------------------------------------------
# Fase 4: eventos y automatización
#   Ledger → outbox → relay → EventBridge → SQS (una cola por flujo) → Lambda → n8n → API interna
# ---------------------------------------------------------------------------
locals {
  n8n_url = "http://n8n.${local.name}.internal:5678" # Cloud Map (módulo n8n)
}

module "events" {
  source = "../../modules/events"

  name               = local.name
  vpc_id             = module.network.vpc_id
  vpc_cidr           = module.network.vpc_cidr
  private_subnet_ids = module.network.private_subnet_ids
  n8n_base_url       = local.n8n_url
  alarm_topic_arns   = [aws_sns_topic.ops_alerts.arn]
}

module "n8n" {
  source = "../../modules/n8n"

  name                       = local.name
  vpc_id                     = module.network.vpc_id
  private_subnet_ids         = module.network.private_subnet_ids
  cluster_arn                = module.ledger.cluster_arn
  allowed_security_group_ids = [module.events.forwarder_security_group_id]

  core_url           = "http://${module.ledger.nlb_dns_name}"
  token_endpoint     = module.cognito.token_endpoint
  client_id          = module.cognito.automation_client_id
  client_secret      = module.cognito.automation_client_secret
  webhook_secret_arn = module.events.webhook_secret_arn
  ops_webhook_url    = var.ops_webhook_url
  push_enabled       = var.push_enabled

  use_spot = true
}

# ---------------------------------------------------------------------------
# Fase 5: asistente financiero (Bedrock + guardrail, solo lectura con el token del usuario)
# ---------------------------------------------------------------------------
module "assistant" {
  source = "../../modules/assistant"

  name                  = local.name
  app_env               = "dev"
  vpc_id                = module.network.vpc_id
  vpc_cidr              = module.network.vpc_cidr
  private_subnet_ids    = module.network.private_subnet_ids
  cluster_arn           = module.ledger.cluster_arn
  nlb_arn               = module.ledger.nlb_arn
  nlb_security_group_id = module.ledger.nlb_security_group_id
  tls_certificate_arn   = try(local.domain.certificate_arn, null)

  core_url           = "http://${module.ledger.nlb_dns_name}"
  cognito_issuer     = module.cognito.issuer
  cognito_client_ids = compact([module.cognito.client_ids.web, module.cognito.client_ids.mobile, module.cognito.client_ids.cli])
  bedrock_model_id   = var.assistant_model_id

  use_spot = true
}

# Alarmas de operación (DLQ con mensajes, etc.) por correo.
resource "aws_sns_topic" "ops_alerts" {
  name = "${local.name}-ops-alerts"
}

resource "aws_sns_topic_subscription" "ops_alerts_email" {
  topic_arn = aws_sns_topic.ops_alerts.arn
  protocol  = "email"
  endpoint  = var.budget_alert_email
}

# ---------------------------------------------------------------------------
# Rol de despliegue para GitHub Actions: solo desde main, solo este servicio
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [module.github_oidc.provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:ref:refs/heads/main"]
    }
  }
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart",
    ]
    resources = [module.ledger.ecr_repository_arn, module.web.ecr_repository_arn, module.n8n.ecr_repository_arn, module.assistant.ecr_repository_arn]
  }
  statement {
    sid       = "TaskDefinitions"
    actions   = ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"]
    resources = ["*"] # estas acciones de ECS no admiten restricción por recurso
  }
  statement {
    sid     = "DeployService"
    actions = ["ecs:UpdateService", "ecs:DescribeServices"]
    resources = [
      "arn:aws:ecs:${var.region}:*:service/${module.ledger.cluster_name}/${module.ledger.service_name}",
      "arn:aws:ecs:${var.region}:*:service/${module.ledger.cluster_name}/${module.web.service_name}",
      "arn:aws:ecs:${var.region}:*:service/${module.ledger.cluster_name}/${module.ledger.relay_service_name}",
      "arn:aws:ecs:${var.region}:*:service/${module.ledger.cluster_name}/${module.n8n.service_name}",
      "arn:aws:ecs:${var.region}:*:service/${module.ledger.cluster_name}/${module.assistant.service_name}",
    ]
  }
  statement {
    sid       = "RunMigrations"
    actions   = ["ecs:RunTask"]
    resources = ["arn:aws:ecs:${var.region}:*:task-definition/${module.ledger.migrate_task_family}:*"]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [module.ledger.cluster_arn]
    }
  }
  statement {
    sid       = "WatchTasks"
    actions   = ["ecs:DescribeTasks"]
    resources = ["arn:aws:ecs:${var.region}:*:task/${module.ledger.cluster_name}/*"]
  }
  statement {
    sid     = "PassTaskRoles"
    actions = ["iam:PassRole"]
    resources = [
      module.ledger.execution_role_arn, module.ledger.task_role_arn,
      module.web.execution_role_arn, module.web.task_role_arn,
      module.ledger.relay_task_role_arn,
      module.n8n.execution_role_arn, module.n8n.task_role_arn,
      module.assistant.execution_role_arn, module.assistant.task_role_arn,
    ]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "deploy_lambda" {
  statement {
    sid       = "DeployForwarder"
    actions   = ["lambda:UpdateFunctionCode", "lambda:GetFunction", "lambda:GetFunctionConfiguration"]
    resources = [module.events.forwarder_function_arn]
  }
}

resource "aws_iam_role_policy" "deploy_lambda" {
  name   = "deploy-forwarder"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy_lambda.json
}

resource "aws_iam_role" "deploy" {
  name                 = "${local.name}-github-deploy"
  assume_role_policy   = data.aws_iam_policy_document.deploy_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy-ledger"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}

# Alerta de presupuesto: evita sorpresas en la cuenta de un proyecto personal.
resource "aws_budgets_budget" "monthly" {
  name         = "${local.name}-mensual"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_alert_email]
  }
}
