output "invoke_url" {
  description = "URL base de la API: el dominio propio si existe, si no la de execute-api con el stage"
  value       = var.api_domain_name == null ? aws_api_gateway_stage.this.invoke_url : "https://${var.api_domain_name}"
}

output "rest_api_id" {
  value = aws_api_gateway_rest_api.this.id
}

output "stage_arn" {
  value = aws_api_gateway_stage.this.arn
}
