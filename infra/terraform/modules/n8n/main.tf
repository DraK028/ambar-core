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

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  region       = data.aws_region.current.name
  account_id   = data.aws_caller_identity.current.account_id
  namespace    = "${var.name}.internal"
  internal_url = "http://n8n.${local.namespace}:${var.port}"
}

# ---------------------------------------------------------------------------
# Imagen: n8n oficial + flujos del repositorio (automation/n8n/Dockerfile)
# ---------------------------------------------------------------------------
resource "aws_ecr_repository" "n8n" {
  name                 = "${var.name}/n8n"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
  }
}

resource "aws_ecr_lifecycle_policy" "n8n" {
  repository = aws_ecr_repository.n8n.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Conservar las 10 imágenes más recientes"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}

# ---------------------------------------------------------------------------
# Descubrimiento: n8n.<name>.internal resuelve a la IP privada de la tarea
# ---------------------------------------------------------------------------
resource "aws_service_discovery_private_dns_namespace" "internal" {
  name        = local.namespace
  description = "Servicios internos del core"
  vpc         = var.vpc_id
}

resource "aws_service_discovery_service" "n8n" {
  name = "n8n"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.internal.id
    routing_policy = "MULTIVALUE"
    dns_records {
      type = "A"
      ttl  = 10
    }
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

# ---------------------------------------------------------------------------
# Secretos: nada de esto viaja como variable de entorno en texto plano
# ---------------------------------------------------------------------------
resource "random_password" "encryption_key" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "n8n" {
  name                    = "${var.name}/n8n/runtime"
  description             = "Llave de cifrado de n8n y secreto del cliente de Cognito"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "n8n" {
  secret_id = aws_secretsmanager_secret.n8n.id
  secret_string = jsonencode({
    encryption_key  = random_password.encryption_key.result
    client_secret   = var.client_secret
    ops_webhook_url = var.ops_webhook_url
  })
}

# ---------------------------------------------------------------------------
# Red: solo el forwarder entra; n8n sale al Ledger (NLB), a Cognito y a Expo Push
# ---------------------------------------------------------------------------
resource "aws_security_group" "n8n" {
  name        = "${var.name}-n8n"
  description = "n8n (automatizacion)"
  vpc_id      = var.vpc_id

  egress {
    description = "Ledger interno, Cognito, Expo Push y webhook de operacion"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_vpc_security_group_ingress_rule" "webhooks" {
  for_each                     = toset(var.allowed_security_group_ids)
  security_group_id            = aws_security_group.n8n.id
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = var.port
  to_port                      = var.port
  description                  = "Webhooks desde el forwarder"
}

# ---------------------------------------------------------------------------
# IAM
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "ecs_tasks_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${var.name}-n8n-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.n8n.arn, var.webhook_secret_arn]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "n8n-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# Rol de la tarea: n8n no llama APIs de AWS. Solo ECS Exec para abrir la UI con
# port forwarding de SSM (la UI nunca se expone a internet).
resource "aws_iam_role" "task" {
  name               = "${var.name}-n8n-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json
}

data "aws_iam_policy_document" "task" {
  statement {
    sid = "EcsExec"
    actions = [
      "ssmmessages:CreateControlChannel", "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel", "ssmmessages:OpenDataChannel",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "ecs-exec"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

# ---------------------------------------------------------------------------
# Tarea y servicio
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "n8n" {
  name              = "/ecs/${var.name}/n8n"
  retention_in_days = var.log_retention_days
}

resource "aws_ecs_task_definition" "n8n" {
  family                   = "${var.name}-n8n"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name         = "n8n"
    image        = "${aws_ecr_repository.n8n.repository_url}:${var.image_tag}"
    essential    = true
    portMappings = [{ containerPort = var.port, protocol = "tcp" }]
    environment = [
      { name = "N8N_PORT", value = tostring(var.port) },
      { name = "N8N_PROTOCOL", value = "http" },
      { name = "WEBHOOK_URL", value = "${local.internal_url}/" },
      # La UI solo se abre por port forwarding (http://localhost), no hay cookie cross-site.
      { name = "N8N_SECURE_COOKIE", value = "false" },
      { name = "AMBAR_CORE_URL", value = var.core_url },
      { name = "AMBAR_CORE_TOKEN_URL", value = var.token_endpoint },
      { name = "AMBAR_CORE_CLIENT_ID", value = var.client_id },
      { name = "PUSH_ENABLED", value = tostring(var.push_enabled) },
      { name = "FRAUD_SCORE_THRESHOLD", value = tostring(var.fraud_score_threshold) },
    ]
    secrets = [
      { name = "N8N_ENCRYPTION_KEY", valueFrom = "${aws_secretsmanager_secret.n8n.arn}:encryption_key::" },
      { name = "AMBAR_CORE_CLIENT_SECRET", valueFrom = "${aws_secretsmanager_secret.n8n.arn}:client_secret::" },
      { name = "OPS_WEBHOOK_URL", valueFrom = "${aws_secretsmanager_secret.n8n.arn}:ops_webhook_url::" },
      { name = "WEBHOOK_SIGNING_SECRET", valueFrom = var.webhook_secret_arn },
    ]
    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://127.0.0.1:${var.port}/healthz || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 120
    }
    stopTimeout = 60
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.n8n.name
        "awslogs-region"        = local.region
        "awslogs-stream-prefix" = "n8n"
      }
    }
  }])
}

# Una sola tarea: la base de dev es SQLite local y el disparador diario no debe correr dos veces.
# Todo el estado importante (flujos y credencial) se reconstruye al arrancar desde la imagen y Secrets Manager.
resource "aws_ecs_service" "n8n" {
  name                               = "n8n"
  cluster                            = var.cluster_arn
  task_definition                    = aws_ecs_task_definition.n8n.arn
  desired_count                      = 1
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  enable_execute_command             = true
  propagate_tags                     = "SERVICE"

  capacity_provider_strategy {
    capacity_provider = var.use_spot ? "FARGATE_SPOT" : "FARGATE"
    weight            = 1
  }

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.n8n.id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.n8n.arn
  }

  lifecycle {
    ignore_changes = [task_definition]
  }
}
