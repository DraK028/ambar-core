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
  container  = "web"
  port       = 3001
  has_domain = var.domain_name != null
  # Con dominio: https://ambar.midominio.com. Sin dominio: el dominio de CloudFront (también HTTPS).
  app_url = local.has_domain ? "https://${var.domain_name}" : "https://${aws_cloudfront_distribution.web.domain_name}"
}

# ---------------------------------------------------------------------------
# Imagen, sesiones y secretos
# ---------------------------------------------------------------------------
resource "aws_ecr_repository" "web" {
  name                 = "${var.name}/web"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = !var.protect_resources

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
  }
}

resource "aws_ecr_lifecycle_policy" "web" {
  repository = aws_ecr_repository.web.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Conservar las 20 imágenes más recientes"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 20 }
      action       = { type = "expire" }
    }]
  })
}

# Sesiones del BFF: una fila por sesión; DynamoDB borra las vencidas con TTL.
resource "aws_dynamodb_table" "sessions" {
  name         = "${var.name}-web-sessions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  server_side_encryption {
    enabled = true
  }

  deletion_protection_enabled = var.protect_resources
}

resource "random_password" "session_secret" {
  length  = 48
  special = false
}

# Encabezado secreto que CloudFront agrega al llamar al ALB: sin él, el ALB responde 403.
resource "random_password" "origin_verify" {
  length  = 40
  special = false
}

resource "aws_secretsmanager_secret" "web" {
  name                    = "${var.name}/web"
  description             = "Secretos de la banca web: llave de sesión y secreto del cliente de Cognito"
  recovery_window_in_days = var.protect_resources ? 30 : 0
}

resource "aws_secretsmanager_secret_version" "web" {
  secret_id = aws_secretsmanager_secret.web.id
  secret_string = jsonencode({
    SESSION_SECRET        = random_password.session_secret.result
    COGNITO_CLIENT_SECRET = var.cognito_client_secret
  })
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${var.name}/web"
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

resource "aws_iam_role" "execution" {
  name               = "${var.name}-web-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secret" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.web.arn]
  }
}

resource "aws_iam_role_policy" "execution_secret" {
  name   = "web-secret"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secret.json
}

# El código de la web solo puede leer y escribir su tabla de sesiones.
resource "aws_iam_role" "task" {
  name               = "${var.name}-web-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json
}

data "aws_iam_policy_document" "task" {
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
    resources = [aws_dynamodb_table.sessions.arn]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "web-sessions"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

# ---------------------------------------------------------------------------
# Red: ALB público que solo acepta tráfico de CloudFront
# ---------------------------------------------------------------------------
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "alb" {
  name        = "${var.name}-web-alb"
  description = "ALB de la banca web: solo desde CloudFront"
  vpc_id      = var.vpc_id

  ingress {
    description     = "HTTP/HTTPS desde los servidores de origen de CloudFront"
    from_port       = local.has_domain ? 443 : 80
    to_port         = local.has_domain ? 443 : 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }

  egress {
    description = "Hacia las tareas de la web"
    from_port   = local.port
    to_port     = local.port
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
}

resource "aws_security_group" "tasks" {
  name        = "${var.name}-web-tasks"
  description = "Tareas de la banca web"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Next.js desde el ALB"
    from_port       = local.port
    to_port         = local.port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "API Gateway, Cognito y DynamoDB"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_lb" "web" {
  name                       = "${var.name}-web"
  load_balancer_type         = "application"
  internal                   = false
  subnets                    = var.public_subnet_ids
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true
  enable_deletion_protection = var.protect_resources
}

resource "aws_lb_target_group" "web" {
  name                 = "${var.name}-web"
  port                 = local.port
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 30

  health_check {
    path                = "/api/health"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "web" {
  load_balancer_arn = aws_lb.web.arn
  port              = local.has_domain ? 443 : 80
  protocol          = local.has_domain ? "HTTPS" : "HTTP"
  certificate_arn   = local.has_domain ? var.certificate_arn : null
  ssl_policy        = local.has_domain ? "ELBSecurityPolicy-TLS13-1-2-2021-06" : null

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Acceso directo no permitido"
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "from_cloudfront" {
  listener_arn = aws_lb_listener.web.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }

  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [random_password.origin_verify.result]
    }
  }
}

# ---------------------------------------------------------------------------
# CloudFront: HTTPS al usuario y sin caché para páginas (cada respuesta es por usuario)
# ---------------------------------------------------------------------------
data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

# Reenvía Host, cookies y query: Next.js compara Origin con Host para proteger las Server Actions.
data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewer"
}

resource "aws_cloudfront_distribution" "web" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${var.name} banca web"
  price_class     = "PriceClass_100"
  http_version    = "http2and3"
  aliases         = local.has_domain ? [var.domain_name] : []

  origin {
    origin_id   = "alb"
    domain_name = aws_lb.web.dns_name

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = local.has_domain ? "https-only" : "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_verify.result
    }
  }

  default_cache_behavior {
    target_origin_id         = "alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
    compress                 = true
  }

  # Archivos de Next.js con hash en el nombre: se pueden cachear sin riesgo.
  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    target_origin_id       = "alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
    compress               = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = local.has_domain ? null : true
    acm_certificate_arn            = local.has_domain ? var.certificate_arn : null
    ssl_support_method             = local.has_domain ? "sni-only" : null
    minimum_protocol_version       = local.has_domain ? "TLSv1.2_2021" : "TLSv1"
  }
}

resource "aws_route53_record" "web" {
  for_each = local.has_domain ? toset(["A", "AAAA"]) : toset([])

  zone_id = var.zone_id
  name    = var.domain_name
  type    = each.value

  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

# ---------------------------------------------------------------------------
# Tarea y servicio
# ---------------------------------------------------------------------------
resource "aws_ecs_task_definition" "web" {
  family                   = "${var.name}-web"
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

  # Sistema de archivos de solo lectura; la única carpeta escribible es la caché de Next.js.
  volume {
    name = "next-cache"
  }

  container_definitions = jsonencode([{
    name                   = local.container
    image                  = "${aws_ecr_repository.web.repository_url}:${var.image_tag}"
    essential              = true
    readonlyRootFilesystem = true
    portMappings           = [{ containerPort = local.port, protocol = "tcp" }]
    mountPoints            = [{ sourceVolume = "next-cache", containerPath = "/app/apps/web/.next/cache", readOnly = false }]
    environment = [
      { name = "APP_ENV", value = var.app_env },
      { name = "APP_URL", value = local.app_url },
      { name = "LEDGER_API_URL", value = var.ledger_api_url },
      { name = "AUTH_PROVIDER", value = "cognito" },
      { name = "COGNITO_DOMAIN", value = var.cognito_domain },
      { name = "COGNITO_CLIENT_ID", value = var.cognito_client_id },
      { name = "COGNITO_ISSUER", value = var.cognito_issuer },
      { name = "SESSION_STORE", value = "dynamodb" },
      { name = "SESSIONS_TABLE", value = aws_dynamodb_table.sessions.name },
      { name = "AWS_REGION", value = local.region },
      { name = "PORT", value = tostring(local.port) },
      { name = "HOSTNAME", value = "0.0.0.0" },
    ]
    secrets = [
      { name = "SESSION_SECRET", valueFrom = "${aws_secretsmanager_secret.web.arn}:SESSION_SECRET::" },
      { name = "COGNITO_CLIENT_SECRET", valueFrom = "${aws_secretsmanager_secret.web.arn}:COGNITO_CLIENT_SECRET::" },
    ]
    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://127.0.0.1:${local.port}/api/health || exit 1"]
      interval    = 15
      timeout     = 3
      retries     = 3
      startPeriod = 20
    }
    stopTimeout = 30
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.web.name
        "awslogs-region"        = local.region
        "awslogs-stream-prefix" = "web"
      }
    }
  }])

  depends_on = [aws_secretsmanager_secret_version.web]
}

resource "aws_ecs_service" "web" {
  name                              = "web"
  cluster                           = var.cluster_arn
  task_definition                   = aws_ecs_task_definition.web.arn
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
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = local.container
    container_port   = local.port
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [task_definition]
  }

  depends_on = [aws_lb_listener_rule.from_cloudfront]
}
