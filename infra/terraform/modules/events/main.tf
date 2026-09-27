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
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  region     = data.aws_region.current.name
  account_id = data.aws_caller_identity.current.account_id
}

# ---------------------------------------------------------------------------
# Bus de eventos del core. El relay del outbox publica aquí (Source ambar.core).
# El archivo guarda cada evento para poder reproducirlo si un consumidor falló.
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_event_bus" "core" {
  name = "${var.name}-core"
}

resource "aws_cloudwatch_event_archive" "core" {
  name             = "${var.name}-core"
  event_source_arn = aws_cloudwatch_event_bus.core.arn
  retention_days   = var.archive_retention_days
  event_pattern    = jsonencode({ source = ["ambar.core"] })
}

# ---------------------------------------------------------------------------
# Una cola (con su DLQ) por flujo de n8n: un flujo lento o caído no retrasa a los demás
# y cada DLQ muestra exactamente qué flujo tiene problemas.
# ---------------------------------------------------------------------------
resource "aws_sqs_queue" "dlq" {
  for_each                  = var.routes
  name                      = "${var.name}-n8n-${each.key}-dlq"
  message_retention_seconds = 1209600 # 14 días para investigar y reprocesar
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "flow" {
  for_each                   = var.routes
  name                       = "${var.name}-n8n-${each.key}"
  visibility_timeout_seconds = 6 * aws_lambda_function.forwarder.timeout
  message_retention_seconds  = 345600
  receive_wait_time_seconds  = 20
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.key].arn
    maxReceiveCount     = var.max_receive_count
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  for_each  = var.routes
  queue_url = aws_sqs_queue.dlq[each.key].id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.flow[each.key].arn]
  })
}

resource "aws_cloudwatch_event_rule" "flow" {
  for_each       = var.routes
  name           = "${var.name}-to-n8n-${each.key}"
  description    = "Eventos ${join(", ", each.value)} hacia el flujo ${each.key} de n8n"
  event_bus_name = aws_cloudwatch_event_bus.core.name
  event_pattern = jsonencode({
    source        = ["ambar.core"]
    "detail-type" = each.value
  })
}

resource "aws_cloudwatch_event_target" "flow" {
  for_each       = var.routes
  rule           = aws_cloudwatch_event_rule.flow[each.key].name
  event_bus_name = aws_cloudwatch_event_bus.core.name
  arn            = aws_sqs_queue.flow[each.key].arn

  retry_policy {
    maximum_event_age_in_seconds = 86400
    maximum_retry_attempts       = 185
  }
}

data "aws_iam_policy_document" "queue" {
  for_each = var.routes
  statement {
    sid       = "EventBridgeSendMessage"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.flow[each.key].arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_event_rule.flow[each.key].arn]
    }
  }
}

resource "aws_sqs_queue_policy" "flow" {
  for_each  = var.routes
  queue_url = aws_sqs_queue.flow[each.key].id
  policy    = data.aws_iam_policy_document.queue[each.key].json
}

resource "aws_cloudwatch_metric_alarm" "dlq" {
  for_each            = var.routes
  alarm_name          = "${var.name}-n8n-${each.key}-dlq"
  alarm_description   = "Hay eventos que el flujo ${each.key} de n8n no pudo procesar"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.dlq[each.key].name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_topic_arns
}

# ---------------------------------------------------------------------------
# Secreto de firma HMAC de los webhooks (forwarder firma, n8n verifica)
# ---------------------------------------------------------------------------
resource "random_password" "webhook" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "webhook" {
  name                    = "${var.name}/events/webhook-signing-secret"
  description             = "HMAC de los webhooks del core hacia n8n"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "webhook" {
  secret_id     = aws_secretsmanager_secret.webhook.id
  secret_string = random_password.webhook.result
}

# ---------------------------------------------------------------------------
# Lambda forwarder (SQS → n8n). Terraform crea la función con un paquete provisional;
# el workflow de despliegue sube el código real (services/event-forwarder) con cada commit.
# ---------------------------------------------------------------------------
resource "aws_security_group" "forwarder" {
  name        = "${var.name}-event-forwarder"
  description = "Lambda que entrega eventos a n8n"
  vpc_id      = var.vpc_id

  egress {
    description = "Webhooks de n8n dentro de la VPC"
    from_port   = var.n8n_port
    to_port     = var.n8n_port
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    description = "APIs de AWS (Secrets Manager) por NAT o endpoint"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

data "archive_file" "placeholder" {
  type        = "zip"
  output_path = "${path.module}/.placeholder-forwarder.zip"
  source {
    filename = "index.js"
    content  = "exports.handler = async (event) => ({ batchItemFailures: event.Records.map((r) => ({ itemIdentifier: r.messageId })) });\n"
  }
}

data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "forwarder" {
  name               = "${var.name}-event-forwarder"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy_attachment" "forwarder_vpc" {
  role       = aws_iam_role.forwarder.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "forwarder" {
  statement {
    sid       = "ConsumeFlowQueues"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]
    resources = [for q in aws_sqs_queue.flow : q.arn]
  }
  statement {
    sid       = "ReadSigningSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.webhook.arn]
  }
}

resource "aws_iam_role_policy" "forwarder" {
  name   = "forwarder"
  role   = aws_iam_role.forwarder.id
  policy = data.aws_iam_policy_document.forwarder.json
}

resource "aws_cloudwatch_log_group" "forwarder" {
  name              = "/aws/lambda/${var.name}-event-forwarder"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "forwarder" {
  function_name    = "${var.name}-event-forwarder"
  role             = aws_iam_role.forwarder.arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  architectures    = ["arm64"]
  memory_size      = 256
  timeout          = 30
  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.forwarder.id]
  }

  environment {
    variables = {
      N8N_WEBHOOK_BASE_URL = var.n8n_base_url
      WEBHOOK_SECRET_ARN   = aws_secretsmanager_secret.webhook.arn
      QUEUE_ROUTES         = jsonencode({ for route, _ in var.routes : "${var.name}-n8n-${route}" => route })
    }
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.forwarder.name
  }

  # El código lo actualiza el workflow de despliegue.
  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  depends_on = [aws_iam_role_policy_attachment.forwarder_vpc, aws_cloudwatch_log_group.forwarder]
}

resource "aws_lambda_event_source_mapping" "flow" {
  for_each                           = var.routes
  event_source_arn                   = aws_sqs_queue.flow[each.key].arn
  function_name                      = aws_lambda_function.forwarder.arn
  batch_size                         = 10
  maximum_batching_window_in_seconds = 1
  function_response_types            = ["ReportBatchItemFailures"]

  # n8n corre en una sola tarea: se limita la concurrencia para no saturarlo.
  scaling_config {
    maximum_concurrency = 2
  }
}
