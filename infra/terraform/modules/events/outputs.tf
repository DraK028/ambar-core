output "bus_name" {
  value = aws_cloudwatch_event_bus.core.name
}

output "bus_arn" {
  value = aws_cloudwatch_event_bus.core.arn
}

output "webhook_secret_arn" {
  value = aws_secretsmanager_secret.webhook.arn
}

output "forwarder_security_group_id" {
  value = aws_security_group.forwarder.id
}

output "forwarder_function_name" {
  value = aws_lambda_function.forwarder.function_name
}

output "forwarder_function_arn" {
  value = aws_lambda_function.forwarder.arn
}

output "dlq_urls" {
  description = "DLQ por flujo, para investigar y reprocesar (aws sqs start-message-move-task)"
  value       = { for k, q in aws_sqs_queue.dlq : k => q.url }
}
