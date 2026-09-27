output "ecr_repository_url" {
  value = aws_ecr_repository.assistant.repository_url
}

output "ecr_repository_arn" {
  value = aws_ecr_repository.assistant.arn
}

output "service_name" {
  value = aws_ecs_service.assistant.name
}

output "task_family" {
  value = aws_ecs_task_definition.assistant.family
}

output "execution_role_arn" {
  value = aws_iam_role.execution.arn
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "guardrail_id" {
  value = aws_bedrock_guardrail.assistant.guardrail_id
}

output "guardrail_version" {
  value = aws_bedrock_guardrail_version.assistant.version
}

output "conversations_table" {
  value = aws_dynamodb_table.conversations.name
}
