output "internal_url" {
  description = "Base de los webhooks de n8n dentro de la VPC"
  value       = local.internal_url
}

output "ecr_repository_url" {
  value = aws_ecr_repository.n8n.repository_url
}

output "ecr_repository_arn" {
  value = aws_ecr_repository.n8n.arn
}

output "service_name" {
  value = aws_ecs_service.n8n.name
}

output "task_family" {
  value = aws_ecs_task_definition.n8n.family
}

output "execution_role_arn" {
  value = aws_iam_role.execution.arn
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "security_group_id" {
  value = aws_security_group.n8n.id
}
