terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.95"
    }
  }
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  region     = data.aws_region.current.name
  account_id = data.aws_caller_identity.current.account_id
  container  = "ledger"
  image      = "${aws_ecr_repository.ledger.repository_url}:${var.image_tag}"
  ca_file    = "/app/certs/rds-global-bundle.pem"
}

# ---------------------------------------------------------------------------
# Imagen
# ---------------------------------------------------------------------------
resource "aws_ecr_repository" "ledger" {
  name                 = "${var.name}/ledger"
  image_tag_mutability = "IMMUTABLE" # una etiqueta (el SHA del commit) nunca cambia de contenido
  force_delete         = !var.protect_resources

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
  }
}

resource "aws_ecr_lifecycle_policy" "ledger" {
  repository = aws_ecr_repository.ledger.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Conservar las 20 imágenes más recientes"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 20 }
      action       = { type = "expire" }
    }]
  })
}

# ---------------------------------------------------------------------------
# Cluster y logs
# ---------------------------------------------------------------------------
resource "aws_ecs_cluster" "this" {
  name = "${var.name}-core"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]
}

resource "aws_cloudwatch_log_group" "ledger" {
  name              = "/ecs/${var.name}/ledger"
  retention_in_days = var.log_retention_days
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

# Rol de ejecución: lo usa el agente de ECS para bajar la imagen, escribir logs
# y leer el secreto maestro de Aurora (solo para la tarea de migraciones).
resource "aws_iam_role" "execution" {
  name               = "${var.name}-ledger-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.db_master_secret_arn]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [var.db_kms_key_arn]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "db-master-secret"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# Rol de la tarea: los permisos del código del Ledger. Solo puede conectarse a
# Aurora como ambar_app mediante token IAM; nada más.
resource "aws_iam_role" "task" {
  name               = "${var.name}-ledger-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json
}

data "aws_iam_policy_document" "task" {
  statement {
    actions   = ["rds-db:connect"]
    resources = ["arn:aws:rds-db:${local.region}:${local.account_id}:dbuser:${var.db_cluster_resource_id}/${var.db_app_user}"]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "aurora-iam-auth"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

# ---------------------------------------------------------------------------
# Red: NLB interno (destino del VPC Link de API Gateway)
# ---------------------------------------------------------------------------
resource "aws_security_group" "nlb" {
  name        = "${var.name}-ledger-nlb"
  description = "NLB interno del Ledger"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP desde la VPC (el tráfico del VPC Link llega por PrivateLink)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  ingress {
    description = "TLS desde la VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    description = "Hacia las tareas del Ledger"
    from_port   = var.container_port
    to_port     = var.container_port
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
}

resource "aws_vpc_security_group_ingress_rule" "tasks_from_nlb" {
  security_group_id            = var.task_security_group_id
  referenced_security_group_id = aws_security_group.nlb.id
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
  description                  = "Ledger desde el NLB interno"
}

resource "aws_lb" "ledger" {
  name                             = "${var.name}-ledger"
  load_balancer_type               = "network"
  internal                         = true
  subnets                          = var.private_subnet_ids
  security_groups                  = [aws_security_group.nlb.id]
  enable_cross_zone_load_balancing = true
  enable_deletion_protection       = var.protect_resources

  # API Gateway entra por PrivateLink; sin esto, el SG del NLB bloquearía ese tráfico.
  enforce_security_group_inbound_rules_on_private_link_traffic = "off"
}

resource "aws_lb_target_group" "ledger" {
  name                 = "${var.name}-ledger"
  port                 = var.container_port
  protocol             = "TCP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 30

  health_check {
    protocol            = "HTTP"
    path                = "/health"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }
}

resource "aws_lb_listener" "ledger" {
  load_balancer_arn = aws_lb.ledger.arn
  port              = 80
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.ledger.arn
  }
}

# Con dominio propio, API Gateway llega al NLB por TLS y valida el certificado (TLS de punta a punta).
resource "aws_lb_listener" "ledger_tls" {
  count             = var.tls_certificate_arn == null ? 0 : 1
  load_balancer_arn = aws_lb.ledger.arn
  port              = 443
  protocol          = "TLS"
  certificate_arn   = var.tls_certificate_arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.ledger.arn
  }
}

# ---------------------------------------------------------------------------
# Task definitions
# ---------------------------------------------------------------------------
locals {
  common_env = [
    { name = "NODE_ENV", value = "production" },
    { name = "APP_ENV", value = var.app_env },
    { name = "DB_HOST", value = var.db_host },
    { name = "DB_NAME", value = "ambar" },
    { name = "DB_SSL_CA_FILE", value = local.ca_file },
    { name = "AWS_REGION", value = local.region },
  ]

  log_config = {
    logDriver = "awslogs"
    options = {
      "awslogs-group"         = aws_cloudwatch_log_group.ledger.name
      "awslogs-region"        = local.region
      "awslogs-stream-prefix" = "ledger"
    }
  }
}

resource "aws_ecs_task_definition" "ledger" {
  family                   = "${var.name}-ledger"
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
    name                   = local.container
    image                  = local.image
    essential              = true
    readonlyRootFilesystem = true
    portMappings           = [{ containerPort = var.container_port, protocol = "tcp" }]
    environment = concat(local.common_env, [
      { name = "PORT", value = tostring(var.container_port) },
      { name = "DB_AUTH", value = "iam" },
      { name = "DB_USER", value = var.db_app_user },
      { name = "DB_POOL_MAX", value = "10" },
      { name = "AUTH_MODE", value = "cognito" },
      { name = "COGNITO_ISSUER", value = var.cognito_issuer },
      { name = "COGNITO_CLIENT_IDS", value = join(",", var.cognito_client_ids) },
      { name = "SCOPE_PREFIX", value = "ambar-api/" },
      { name = "ENABLE_QA_ENDPOINTS", value = tostring(var.enable_qa_endpoints) },
      { name = "STEP_UP_CLIENT_IDS", value = join(",", var.step_up_client_ids) },
      { name = "STEP_UP_THRESHOLD", value = tostring(var.step_up_threshold) },
      { name = "INTERNAL_CLIENT_IDS", value = join(",", var.internal_client_ids) },
    ])
    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://127.0.0.1:${var.container_port}/health || exit 1"]
      interval    = 15
      timeout     = 3
      retries     = 3
      startPeriod = 20
    }
    stopTimeout      = 30
    logConfiguration = local.log_config
  }])
}

# Tarea única de migraciones: misma imagen, otro comando, credenciales del usuario maestro.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${var.name}-ledger-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name                   = "${local.container}-migrate"
    image                  = local.image
    essential              = true
    readonlyRootFilesystem = true
    command                = ["node", "dist/infrastructure/migrate.cli.js"]
    environment            = concat(local.common_env, [{ name = "DB_AUTH", value = "password" }])
    secrets = [
      { name = "DB_USER", valueFrom = "${var.db_master_secret_arn}:username::" },
      { name = "DB_PASSWORD", valueFrom = "${var.db_master_secret_arn}:password::" },
    ]
    logConfiguration = merge(local.log_config, {
      options = merge(local.log_config.options, { "awslogs-stream-prefix" = "migrate" })
    })
  }])
}

# ---------------------------------------------------------------------------
# Servicio
# ---------------------------------------------------------------------------
resource "aws_ecs_service" "ledger" {
  name                              = "ledger"
  cluster                           = aws_ecs_cluster.this.id
  task_definition                   = aws_ecs_task_definition.ledger.arn
  desired_count                     = var.desired_count
  health_check_grace_period_seconds = 30
  propagate_tags                    = "SERVICE"
  enable_execute_command            = false

  capacity_provider_strategy {
    capacity_provider = var.use_spot ? "FARGATE_SPOT" : "FARGATE"
    weight            = 1
  }

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.task_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.ledger.arn
    container_name   = local.container
    container_port   = var.container_port
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # El workflow de despliegue registra nuevas revisiones con la imagen de cada commit.
  lifecycle {
    ignore_changes = [task_definition]
  }

  depends_on = [aws_lb_listener.ledger, aws_lb_listener.ledger_tls, aws_ecs_cluster_capacity_providers.this]
}

# ---------------------------------------------------------------------------
# Relay del outbox: misma imagen, otro comando. Publica en EventBridge y se conecta
# como ambar_relay (solo puede leer y marcar ledger.outbox).
# ---------------------------------------------------------------------------
locals {
  relay_enabled = var.event_bus_name != null
}

resource "aws_iam_role" "relay" {
  count              = local.relay_enabled ? 1 : 0
  name               = "${var.name}-outbox-relay-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json
}

data "aws_iam_policy_document" "relay" {
  count = local.relay_enabled ? 1 : 0
  statement {
    sid       = "AuroraAsRelay"
    actions   = ["rds-db:connect"]
    resources = ["arn:aws:rds-db:${local.region}:${local.account_id}:dbuser:${var.db_cluster_resource_id}/${var.db_relay_user}"]
  }
  statement {
    sid       = "PublishCoreEvents"
    actions   = ["events:PutEvents"]
    resources = [var.event_bus_arn]
  }
}

resource "aws_iam_role_policy" "relay" {
  count  = local.relay_enabled ? 1 : 0
  name   = "outbox-relay"
  role   = aws_iam_role.relay[0].id
  policy = data.aws_iam_policy_document.relay[0].json
}

resource "aws_ecs_task_definition" "relay" {
  count                    = local.relay_enabled ? 1 : 0
  family                   = "${var.name}-outbox-relay"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.relay[0].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name                   = "outbox-relay"
    image                  = local.image
    essential              = true
    readonlyRootFilesystem = true
    command                = ["node", "dist/relay/main.js"]
    environment = concat(local.common_env, [
      { name = "DB_AUTH", value = "iam" },
      { name = "DB_USER", value = var.db_relay_user },
      { name = "RELAY_PUBLISHER", value = "eventbridge" },
      { name = "EVENT_BUS_NAME", value = var.event_bus_name },
      { name = "RELAY_HEALTH_PORT", value = "3001" },
    ])
    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://127.0.0.1:3001/health || exit 1"]
      interval    = 30
      timeout     = 3
      retries     = 3
      startPeriod = 20
    }
    stopTimeout = 30
    logConfiguration = merge(local.log_config, {
      options = merge(local.log_config.options, { "awslogs-stream-prefix" = "relay" })
    })
  }])
}

resource "aws_ecs_service" "relay" {
  count           = local.relay_enabled ? 1 : 0
  name            = "outbox-relay"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.relay[0].arn
  desired_count   = var.relay_desired_count
  propagate_tags  = "SERVICE"

  capacity_provider_strategy {
    capacity_provider = var.use_spot ? "FARGATE_SPOT" : "FARGATE"
    weight            = 1
  }

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.task_security_group_id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [task_definition]
  }

  depends_on = [aws_ecs_cluster_capacity_providers.this]
}
