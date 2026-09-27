terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.95"
    }
  }
}

# ---------------------------------------------------------------------------
# Rol de CloudWatch a nivel cuenta (requisito para logs de ejecución y de acceso).
# Es una sola configuración por región y cuenta; si ya existe, usa manage_account_role = false.
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "apigw_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["apigateway.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cloudwatch" {
  count              = var.manage_account_role ? 1 : 0
  name               = "${var.name}-apigw-cloudwatch"
  assume_role_policy = data.aws_iam_policy_document.apigw_trust.json
}

resource "aws_iam_role_policy_attachment" "cloudwatch" {
  count      = var.manage_account_role ? 1 : 0
  role       = aws_iam_role.cloudwatch[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
}

resource "aws_api_gateway_account" "this" {
  count               = var.manage_account_role ? 1 : 0
  cloudwatch_role_arn = aws_iam_role.cloudwatch[0].arn
}

# ---------------------------------------------------------------------------
# API REST, VPC Link y autorizador de Cognito
# ---------------------------------------------------------------------------
resource "aws_api_gateway_rest_api" "this" {
  name        = "${var.name}-core-api"
  description = "Ámbar Core API (contrato en packages/api-contract/openapi.yaml)"

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

locals {
  # Sin dominio: HTTP dentro de PrivateLink. Con dominio: TLS hasta el NLB, validando que el
  # certificado corresponda a backend_tls_hostname (el host de la URI no necesita DNS).
  backend = var.backend_tls_hostname == null ? "http://${var.nlb_dns_name}" : "https://${var.backend_tls_hostname}"
}

resource "aws_api_gateway_vpc_link" "this" {
  name        = "${var.name}-core"
  target_arns = [var.nlb_arn]
}

# Primera barrera: el token debe ser un access token válido del user pool con al menos
# un scope de ambar-api. El Ledger vuelve a validar firma, scopes exactos y grupo.
resource "aws_api_gateway_authorizer" "cognito" {
  name            = "cognito"
  rest_api_id     = aws_api_gateway_rest_api.this.id
  type            = "COGNITO_USER_POOLS"
  provider_arns   = [var.user_pool_arn]
  identity_source = "method.request.header.Authorization"
}

# /health → público
resource "aws_api_gateway_resource" "health" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "health"
}

resource "aws_api_gateway_method" "health" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.health.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "health" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.health.id
  http_method             = aws_api_gateway_method.health.http_method
  type                    = "HTTP_PROXY"
  integration_http_method = "GET"
  uri                     = "${local.backend}/health"
  connection_type         = "VPC_LINK"
  connection_id           = aws_api_gateway_vpc_link.this.id
}

# /v1/{proxy+} → autenticado, todo pasa al Ledger
resource "aws_api_gateway_resource" "v1" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "v1"
}

resource "aws_api_gateway_resource" "proxy" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.v1.id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "proxy" {
  rest_api_id          = aws_api_gateway_rest_api.this.id
  resource_id          = aws_api_gateway_resource.proxy.id
  http_method          = "ANY"
  authorization        = "COGNITO_USER_POOLS"
  authorizer_id        = aws_api_gateway_authorizer.cognito.id
  authorization_scopes = var.api_scopes

  request_parameters = {
    "method.request.path.proxy" = true
  }
}

resource "aws_api_gateway_integration" "proxy" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.proxy.id
  http_method             = aws_api_gateway_method.proxy.http_method
  type                    = "HTTP_PROXY"
  integration_http_method = "ANY"
  uri                     = "${local.backend}/v1/{proxy}"
  connection_type         = "VPC_LINK"
  connection_id           = aws_api_gateway_vpc_link.this.id
  timeout_milliseconds    = 10000

  request_parameters = {
    "integration.request.path.proxy" = "method.request.path.proxy"
  }
}

# /v1/internal/* → nunca se publica. La API interna solo se llama dentro de la VPC (n8n → NLB).
# Una ruta más específica que {proxy+} responde 404 sin llegar al Ledger ni pasar por el authorizer.
resource "aws_api_gateway_resource" "internal" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.v1.id
  path_part   = "internal"
}

resource "aws_api_gateway_resource" "internal_proxy" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.internal.id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "internal" {
  for_each      = { base = aws_api_gateway_resource.internal.id, proxy = aws_api_gateway_resource.internal_proxy.id }
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = each.value
  http_method   = "ANY"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "internal" {
  for_each          = aws_api_gateway_method.internal
  rest_api_id       = aws_api_gateway_rest_api.this.id
  resource_id       = each.value.resource_id
  http_method       = each.value.http_method
  type              = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 404}" }
}

resource "aws_api_gateway_method_response" "internal" {
  for_each    = aws_api_gateway_method.internal
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = each.value.resource_id
  http_method = each.value.http_method
  status_code = "404"
}

resource "aws_api_gateway_integration_response" "internal" {
  for_each    = aws_api_gateway_method.internal
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = each.value.resource_id
  http_method = each.value.http_method
  status_code = aws_api_gateway_method_response.internal[each.key].status_code

  response_templates = {
    "application/json" = jsonencode({
      type   = "https://docs.ambar.example/errors/not-found"
      title  = "No encontrado"
      status = 404
      code   = "NOT_FOUND"
      detail = "La ruta no existe."
    })
  }

  depends_on = [aws_api_gateway_integration.internal]
}

# /v1/assistant/* → servicio del asistente (otro puerto del mismo NLB). El modelo puede tardar:
# el tiempo de integración sube a 29 s, el máximo por defecto de API Gateway.
locals {
  assistant_backend = var.backend_tls_hostname == null ? "http://${var.nlb_dns_name}:${var.assistant_port}" : "https://${var.backend_tls_hostname}:${var.assistant_tls_port}"
}

resource "aws_api_gateway_resource" "assistant" {
  count       = var.enable_assistant ? 1 : 0
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.v1.id
  path_part   = "assistant"
}

resource "aws_api_gateway_resource" "assistant_proxy" {
  count       = var.enable_assistant ? 1 : 0
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.assistant[0].id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "assistant" {
  count                = var.enable_assistant ? 1 : 0
  rest_api_id          = aws_api_gateway_rest_api.this.id
  resource_id          = aws_api_gateway_resource.assistant_proxy[0].id
  http_method          = "ANY"
  authorization        = "COGNITO_USER_POOLS"
  authorizer_id        = aws_api_gateway_authorizer.cognito.id
  authorization_scopes = var.assistant_scopes

  request_parameters = {
    "method.request.path.proxy" = true
  }
}

resource "aws_api_gateway_integration" "assistant" {
  count                   = var.enable_assistant ? 1 : 0
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.assistant_proxy[0].id
  http_method             = aws_api_gateway_method.assistant[0].http_method
  type                    = "HTTP_PROXY"
  integration_http_method = "ANY"
  uri                     = "${local.assistant_backend}/v1/assistant/{proxy}"
  connection_type         = "VPC_LINK"
  connection_id           = aws_api_gateway_vpc_link.this.id
  timeout_milliseconds    = 29000

  request_parameters = {
    "integration.request.path.proxy" = "method.request.path.proxy"
  }
}

# ---------------------------------------------------------------------------
# Errores del gateway en el mismo formato RFC 9457 que el Ledger
# ---------------------------------------------------------------------------
locals {
  # Cada tipo de error del gateway con su status fijo. Los DEFAULT_* fijan 400 y 502
  # para que el campo status del cuerpo siempre coincida con el status HTTP.
  gateway_errors = {
    UNAUTHORIZED                 = { status = 401, code = "UNAUTHENTICATED", title = "No autenticado" }
    ACCESS_DENIED                = { status = 403, code = "FORBIDDEN", title = "Sin permiso" }
    WAF_FILTERED                 = { status = 403, code = "FORBIDDEN", title = "Solicitud bloqueada" }
    MISSING_AUTHENTICATION_TOKEN = { status = 404, code = "NOT_FOUND", title = "No encontrado" }
    RESOURCE_NOT_FOUND           = { status = 404, code = "NOT_FOUND", title = "No encontrado" }
    REQUEST_TOO_LARGE            = { status = 413, code = "HTTP_413", title = "Solicitud demasiado grande" }
    THROTTLED                    = { status = 429, code = "RATE_LIMITED", title = "Demasiadas solicitudes" }
    INTEGRATION_FAILURE          = { status = 502, code = "UPSTREAM_ERROR", title = "Error del servicio" }
    INTEGRATION_TIMEOUT          = { status = 504, code = "UPSTREAM_TIMEOUT", title = "El servicio no respondió a tiempo" }
    DEFAULT_4XX                  = { status = 400, code = "VALIDATION_ERROR", title = "Solicitud inválida" }
    DEFAULT_5XX                  = { status = 502, code = "UPSTREAM_ERROR", title = "Error del servicio" }
  }
}

resource "aws_api_gateway_gateway_response" "problem" {
  for_each      = local.gateway_errors
  rest_api_id   = aws_api_gateway_rest_api.this.id
  response_type = each.key
  status_code   = tostring(each.value.status)

  response_parameters = {
    "gatewayresponse.header.Content-Type"  = "'application/problem+json'"
    "gatewayresponse.header.Cache-Control" = "'no-store'"
  }

  # $context.error.messageString ya viene como cadena JSON escapada (con comillas).
  response_templates = {
    "application/json" = join("", [
      "{",
      "\"type\":${jsonencode("https://docs.ambar.example/errors/${lower(replace(each.value.code, "_", "-"))}")},",
      "\"title\":${jsonencode(each.value.title)},",
      "\"status\":${each.value.status},",
      "\"code\":${jsonencode(each.value.code)},",
      "\"detail\":$context.error.messageString,",
      "\"trace_id\":\"$context.requestId\"",
      "}",
    ])
  }
}

# ---------------------------------------------------------------------------
# Despliegue, stage, logs y límites
# ---------------------------------------------------------------------------
resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.health,
      aws_api_gateway_method.health,
      aws_api_gateway_integration.health,
      aws_api_gateway_resource.v1,
      aws_api_gateway_resource.proxy,
      aws_api_gateway_method.proxy,
      aws_api_gateway_integration.proxy,
      aws_api_gateway_resource.internal,
      aws_api_gateway_resource.internal_proxy,
      aws_api_gateway_method.internal,
      aws_api_gateway_integration.internal,
      aws_api_gateway_integration_response.internal,
      aws_api_gateway_resource.assistant,
      aws_api_gateway_resource.assistant_proxy,
      aws_api_gateway_method.assistant,
      aws_api_gateway_integration.assistant,
      aws_api_gateway_authorizer.cognito,
      aws_api_gateway_gateway_response.problem,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_cloudwatch_log_group" "access" {
  name              = "/apigateway/${var.name}-core-api/access"
  retention_in_days = var.log_retention_days
}

resource "aws_api_gateway_stage" "this" {
  rest_api_id          = aws_api_gateway_rest_api.this.id
  deployment_id        = aws_api_gateway_deployment.this.id
  stage_name           = var.stage_name
  xray_tracing_enabled = true

  # Bitácora de acceso sin cuerpos ni tokens: quién, qué ruta, resultado y latencia.
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    format = jsonencode({
      requestId          = "$context.requestId"
      ip                 = "$context.identity.sourceIp"
      sub                = "$context.authorizer.claims.sub"
      clientId           = "$context.authorizer.claims.client_id"
      method             = "$context.httpMethod"
      path               = "$context.resourcePath"
      status             = "$context.status"
      latencyMs          = "$context.responseLatency"
      integrationLatency = "$context.integration.latency"
      wafStatus          = "$context.waf.status"
      userAgent          = "$context.identity.userAgent"
    })
  }

  depends_on = [aws_api_gateway_account.this]
}

resource "aws_api_gateway_method_settings" "all" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  stage_name  = aws_api_gateway_stage.this.stage_name
  method_path = "*/*"

  settings {
    metrics_enabled        = true
    logging_level          = "ERROR"
    data_trace_enabled     = false # nunca registrar cuerpos: contienen datos personales
    throttling_rate_limit  = var.throttle_rate_limit
    throttling_burst_limit = var.throttle_burst_limit
  }
}

# ---------------------------------------------------------------------------
# WAF (opcional por costo): reglas administradas y límite por IP
# ---------------------------------------------------------------------------
resource "aws_wafv2_web_acl" "this" {
  count = var.enable_waf ? 1 : 0
  name  = "${var.name}-core-api"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "aws-common"
    priority = 10
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "aws-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 20
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "aws-known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-ip-reputation"
    priority = 30
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "aws-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-limit-per-ip"
    priority = 40
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit_per_5min
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "rate-limit-per-ip"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name}-core-api"
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "this" {
  count        = var.enable_waf ? 1 : 0
  resource_arn = aws_api_gateway_stage.this.arn
  web_acl_arn  = aws_wafv2_web_acl.this[0].arn
}

# ---------------------------------------------------------------------------
# Dominio propio de la API (opcional): https://api.<dominio>
# ---------------------------------------------------------------------------
resource "aws_api_gateway_domain_name" "this" {
  count                    = var.api_domain_name == null ? 0 : 1
  domain_name              = var.api_domain_name
  regional_certificate_arn = var.certificate_arn
  security_policy          = "TLS_1_2"

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

resource "aws_api_gateway_base_path_mapping" "this" {
  count       = var.api_domain_name == null ? 0 : 1
  api_id      = aws_api_gateway_rest_api.this.id
  stage_name  = aws_api_gateway_stage.this.stage_name
  domain_name = aws_api_gateway_domain_name.this[0].domain_name
}

resource "aws_route53_record" "api" {
  count   = var.api_domain_name == null ? 0 : 1
  zone_id = var.zone_id
  name    = var.api_domain_name
  type    = "A"

  alias {
    name                   = aws_api_gateway_domain_name.this[0].regional_domain_name
    zone_id                = aws_api_gateway_domain_name.this[0].regional_zone_id
    evaluate_target_health = false
  }
}
