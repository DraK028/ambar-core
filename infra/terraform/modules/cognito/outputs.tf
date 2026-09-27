output "user_pool_id" {
  value = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.this.arn
}

output "issuer" {
  description = "Valor de COGNITO_ISSUER para el Ledger"
  value       = "https://${aws_cognito_user_pool.this.endpoint}"
}

output "hosted_domain" {
  description = "Dominio OAuth2 (authorize, token, logout)"
  value       = "https://${aws_cognito_user_pool_domain.this.domain}.auth.${split(".", aws_cognito_user_pool.this.endpoint)[1]}.amazoncognito.com"
}

output "scope_identifiers" {
  description = "Scopes completos, p. ej. ambar-api/transfers.write"
  value       = aws_cognito_resource_server.api.scope_identifiers
}

output "public_scope_identifiers" {
  description = "Scopes que acepta API Gateway (sin los internal.*, que solo se usan dentro de la VPC)"
  value       = [for s in aws_cognito_resource_server.api.scope_identifiers : s if !strcontains(s, "/internal.")]
}

output "automation_client_id" {
  value = aws_cognito_user_pool_client.automation.id
}

output "automation_client_secret" {
  description = "Secreto del cliente de n8n. Se guarda en Secrets Manager (módulo n8n)."
  value       = aws_cognito_user_pool_client.automation.client_secret
  sensitive   = true
}

output "token_endpoint" {
  value = "https://${aws_cognito_user_pool_domain.this.domain}.auth.${split(".", aws_cognito_user_pool.this.endpoint)[1]}.amazoncognito.com/oauth2/token"
}

output "client_ids" {
  description = "IDs de los app clients por uso"
  value = {
    web        = aws_cognito_user_pool_client.web.id
    mobile     = aws_cognito_user_pool_client.mobile.id
    ops        = aws_cognito_user_pool_client.ops.id
    cli        = one(aws_cognito_user_pool_client.cli[*].id)
    qa         = one(aws_cognito_user_pool_client.qa[*].id)
    automation = aws_cognito_user_pool_client.automation.id
  }
}

output "all_client_ids" {
  description = "Lista para COGNITO_CLIENT_IDS del Ledger"
  value = compact([
    aws_cognito_user_pool_client.web.id,
    aws_cognito_user_pool_client.mobile.id,
    aws_cognito_user_pool_client.ops.id,
    one(aws_cognito_user_pool_client.cli[*].id),
    one(aws_cognito_user_pool_client.qa[*].id),
    aws_cognito_user_pool_client.automation.id,
  ])
}

output "web_client_secret" {
  description = "Secreto del cliente web (BFF). Se guarda en Secrets Manager, nunca en variables de entorno planas."
  value       = aws_cognito_user_pool_client.web.client_secret
  sensitive   = true
}
