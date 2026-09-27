output "app_url" {
  description = "URL pública de la banca web"
  value       = local.app_url
}

output "cloudfront_domain" {
  value = aws_cloudfront_distribution.web.domain_name
}

output "ecr_repository_url" {
  value = aws_ecr_repository.web.repository_url
}

output "ecr_repository_arn" {
  value = aws_ecr_repository.web.arn
}

output "service_name" {
  value = aws_ecs_service.web.name
}

output "task_family" {
  value = aws_ecs_task_definition.web.family
}

output "execution_role_arn" {
  value = aws_iam_role.execution.arn
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "sessions_table" {
  value = aws_dynamodb_table.sessions.name
}
