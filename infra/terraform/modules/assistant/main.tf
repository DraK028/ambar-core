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
  region     = data.aws_region.current.name
  account_id = data.aws_caller_identity.current.account_id

  # Perfil de inferencia entre regiones ("us.modelo…") o modelo base en esta región.
  is_profile = can(regex("^(us|eu|apac|global)\\.", var.bedrock_model_id))
  base_model = local.is_profile ? replace(var.bedrock_model_id, "/^[a-z]+\\./", "") : var.bedrock_model_id
  model_arns = local.is_profile ? [
    "arn:aws:bedrock:${local.region}:${local.account_id}:inference-profile/${var.bedrock_model_id}",
    "arn:aws:bedrock:*::foundation-model/${local.base_model}",
  ] : ["arn:aws:bedrock:${local.region}::foundation-model/${var.bedrock_model_id}"]
}

# ---------------------------------------------------------------------------
# Guardrail de Bedrock: segunda barrera, además de la redacción y la revisión propias.
# Se aplica a la entrada y a la salida de cada llamada al modelo.
# ---------------------------------------------------------------------------
resource "aws_bedrock_guardrail" "assistant" {
  name                      = "${var.name}-assistant"
  description               = "Asistente financiero de Ámbar"
  blocked_input_messaging   = "No puedo ayudarte con eso. Pregúntame por tu saldo, tus movimientos o tus avisos."
  blocked_outputs_messaging = "No puedo darte esa respuesta. Pregúntame por tu saldo, tus movimientos o tus avisos."

  content_policy_config {
    filters_config {
      type            = "PROMPT_ATTACK"
      input_strength  = "HIGH"
      output_strength = "NONE"
    }
    dynamic "filters_config" {
      for_each = toset(["HATE", "INSULTS", "SEXUAL", "VIOLENCE", "MISCONDUCT"])
      content {
        type            = filters_config.value
        input_strength  = "HIGH"
        output_strength = "HIGH"
      }
    }
  }

  sensitive_information_policy_config {
    # Credenciales: se bloquean. Datos de contacto y cuentas: se anonimizan.
    dynamic "pii_entities_config" {
      for_each = toset(["PIN", "PASSWORD", "CREDIT_DEBIT_CARD_CVV", "AWS_ACCESS_KEY", "AWS_SECRET_KEY"])
      content {
        type   = pii_entities_config.value
        action = "BLOCK"
      }
    }
    dynamic "pii_entities_config" {
      for_each = toset(["CREDIT_DEBIT_CARD_NUMBER", "EMAIL", "PHONE", "NAME", "ADDRESS", "US_BANK_ACCOUNT_NUMBER", "INTERNATIONAL_BANK_ACCOUNT_NUMBER"])
      content {
        type   = pii_entities_config.value
        action = "ANONYMIZE"
      }
    }
    regexes_config {
      name        = "clabe"
      description = "CLABE interbancaria (18 dígitos)"
      pattern     = "\\b\\d{18}\\b"
      action      = "ANONYMIZE"
    }
    regexes_config {
      name        = "curp"
      description = "CURP"
      pattern     = "\\b[A-Z][AEIOUX][A-Z]{2}\\d{6}[HMX][A-Z]{5}[A-Z0-9]\\d\\b"
      action      = "ANONYMIZE"
    }
  }

  topic_policy_config {
    topics_config {
      name       = "asesoria-de-inversion"
      type       = "DENY"
      definition = "Recomendaciones personalizadas para comprar o vender acciones, criptomonedas, fondos u otros instrumentos de inversión."
      examples   = ["¿En qué acciones debo invertir mis ahorros?", "¿Compro bitcoin ahora?"]
    }
    topics_config {
      name       = "evasion-o-fraude"
      type       = "DENY"
      definition = "Ayuda para evadir impuestos, lavar dinero, burlar controles del banco o engañar a otras personas."
      examples   = ["¿Cómo muevo dinero sin que lo reporten?", "¿Cómo convenzo a alguien de darme su NIP?"]
    }
  }

  word_policy_config {
    managed_word_lists_config {
      type = "PROFANITY"
    }
  }
}

resource "aws_bedrock_guardrail_version" "assistant" {
  guardrail_arn = aws_bedrock_guardrail.assistant.guardrail_arn
  description   = "Versión desplegada con Terraform"

  lifecycle {
    replace_triggered_by = [aws_bedrock_guardrail.assistant]
  }
}

# ---------------------------------------------------------------------------
# Conversaciones: solo texto redactado, TTL de 24 h, cifrado en reposo
# ---------------------------------------------------------------------------
resource "aws_dynamodb_table" "conversations" {
  name         = "${var.name}-assistant-conversations"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  server_side_encryption {
    enabled = true
  }

  point_in_time_recovery {
    enabled = false # conversaciones efímeras: no se respaldan
  }
}

resource "random_password" "audit_salt" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "assistant" {
  name                    = "${var.name}/assistant/runtime"
  description             = "Sal para seudonimizar usuarios en la auditoría del asistente"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "assistant" {
  secret_id     = aws_secretsmanager_secret.assistant.id
  secret_string = jsonencode({ audit_salt = random_password.audit_salt.result })
}

# ---------------------------------------------------------------------------
# Imagen, logs e IAM
# ---------------------------------------------------------------------------
resource "aws_ecr_repository" "assistant" {
  name                 = "${var.name}/assistant"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
  }
}

resource "aws_ecr_lifecycle_policy" "assistant" {
  repository = aws_ecr_repository.assistant.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Conservar las 20 imágenes más recientes"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 20 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "assistant" {
  name              = "/ecs/${var.name}/assistant"
  retention_in_days = var.log_retention_days
}

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
  name               = "${var.name}-assistant-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.assistant.arn]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "assistant-secret"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# Rol de la tarea: invocar SOLO el modelo configurado, siempre con el guardrail, y su tabla.
# Sin acceso a Aurora: los datos bancarios llegan por la API del core con el token del usuario.
resource "aws_iam_role" "task" {
  name               = "${var.name}-assistant-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json
}

data "aws_iam_policy_document" "task" {
  statement {
    sid       = "InvokeConfiguredModel"
    actions   = ["bedrock:InvokeModel"]
    resources = local.model_arns
  }
  statement {
    sid       = "ApplyGuardrail"
    actions   = ["bedrock:ApplyGuardrail"]
    resources = [aws_bedrock_guardrail.assistant.guardrail_arn]
  }
  statement {
    sid       = "Conversations"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"]
    resources = [aws_dynamodb_table.conversations.arn]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "assistant"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

# ---------------------------------------------------------------------------
# Red: el NLB del core expone el asistente en otro puerto
# ---------------------------------------------------------------------------
resource "aws_security_group" "assistant" {
  name        = "${var.name}-assistant"
  description = "Tareas del asistente"
  vpc_id      = var.vpc_id

  egress {
    description = "Ledger por el NLB interno"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    description = "Bedrock, DynamoDB, Cognito (JWKS) y logs por HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_vpc_security_group_ingress_rule" "from_nlb" {
  security_group_id            = aws_security_group.assistant.id
  referenced_security_group_id = var.nlb_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
  description                  = "Asistente desde el NLB interno"
}

resource "aws_vpc_security_group_ingress_rule" "nlb_listener" {
  for_each          = toset([tostring(var.listener_port), tostring(var.tls_listener_port)])
  security_group_id = var.nlb_security_group_id
  cidr_ipv4         = var.vpc_cidr
  ip_protocol       = "tcp"
  from_port         = tonumber(each.value)
  to_port           = tonumber(each.value)
  description       = "Asistente desde la VPC (VPC Link)"
}

resource "aws_vpc_security_group_egress_rule" "nlb_to_assistant" {
  security_group_id = var.nlb_security_group_id
  cidr_ipv4         = var.vpc_cidr
  ip_protocol       = "tcp"
  from_port         = var.container_port
  to_port           = var.container_port
  description       = "Hacia las tareas del asistente"
}

resource "aws_lb_target_group" "assistant" {
  name                 = "${var.name}-assistant"
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

resource "aws_lb_listener" "assistant" {
  load_balancer_arn = var.nlb_arn
  port              = var.listener_port
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.assistant.arn
  }
}

resource "aws_lb_listener" "assistant_tls" {
  count             = var.tls_certificate_arn == null ? 0 : 1
  load_balancer_arn = var.nlb_arn
  port              = var.tls_listener_port
  protocol          = "TLS"
  certificate_arn   = var.tls_certificate_arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.assistant.arn
  }
}

# ---------------------------------------------------------------------------
# Tarea y servicio
# ---------------------------------------------------------------------------
resource "aws_ecs_task_definition" "assistant" {
  family                   = "${var.name}-assistant"
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
    name                   = "assistant"
    image                  = "${aws_ecr_repository.assistant.repository_url}:${var.image_tag}"
    essential              = true
    readonlyRootFilesystem = true
    portMappings           = [{ containerPort = var.container_port, protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "APP_ENV", value = var.app_env },
      { name = "PORT", value = tostring(var.container_port) },
      { name = "AUTH_MODE", value = "cognito" },
      { name = "COGNITO_ISSUER", value = var.cognito_issuer },
      { name = "COGNITO_CLIENT_IDS", value = join(",", var.cognito_client_ids) },
      { name = "CORE_API_URL", value = var.core_url },
      { name = "MODEL_PROVIDER", value = "bedrock" },
      { name = "BEDROCK_MODEL_ID", value = var.bedrock_model_id },
      { name = "BEDROCK_GUARDRAIL_ID", value = aws_bedrock_guardrail.assistant.guardrail_id },
      { name = "BEDROCK_GUARDRAIL_VERSION", value = aws_bedrock_guardrail_version.assistant.version },
      { name = "CONVERSATION_STORE", value = "dynamodb" },
      { name = "CONVERSATIONS_TABLE", value = aws_dynamodb_table.conversations.name },
      { name = "DAILY_MESSAGE_LIMIT", value = tostring(var.daily_message_limit) },
      { name = "AWS_REGION", value = local.region },
    ]
    secrets = [
      { name = "AUDIT_SALT", valueFrom = "${aws_secretsmanager_secret.assistant.arn}:audit_salt::" },
    ]
    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://127.0.0.1:${var.container_port}/health || exit 1"]
      interval    = 15
      timeout     = 3
      retries     = 3
      startPeriod = 20
    }
    stopTimeout = 30
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.assistant.name
        "awslogs-region"        = local.region
        "awslogs-stream-prefix" = "assistant"
      }
    }
  }])
}

resource "aws_ecs_service" "assistant" {
  name                              = "assistant"
  cluster                           = var.cluster_arn
  task_definition                   = aws_ecs_task_definition.assistant.arn
  desired_count                     = var.desired_count
  health_check_grace_period_seconds = 30
  propagate_tags                    = "SERVICE"

  capacity_provider_strategy {
    capacity_provider = var.use_spot ? "FARGATE_SPOT" : "FARGATE"
    weight            = 1
  }

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.assistant.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.assistant.arn
    container_name   = "assistant"
    container_port   = var.container_port
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [task_definition]
  }

  depends_on = [aws_lb_listener.assistant, aws_lb_listener.assistant_tls]
}

# Tokens y latencia del modelo, a partir de los registros de auditoría (sin contenido).
resource "aws_cloudwatch_log_metric_filter" "tokens" {
  name           = "${var.name}-assistant-tokens"
  log_group_name = aws_cloudwatch_log_group.assistant.name
  pattern        = "{ $.event = \"assistant.turn\" }"

  metric_transformation {
    name      = "AssistantOutputTokens"
    namespace = "Ambar/Assistant"
    value     = "$.output_tokens"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_log_metric_filter" "guardrail" {
  name           = "${var.name}-assistant-guardrail"
  log_group_name = aws_cloudwatch_log_group.assistant.name
  pattern        = "{ $.event = \"assistant.turn\" && $.guardrail IS TRUE }"

  metric_transformation {
    name      = "AssistantGuardrailInterventions"
    namespace = "Ambar/Assistant"
    value     = "1"
    unit      = "Count"
  }
}
