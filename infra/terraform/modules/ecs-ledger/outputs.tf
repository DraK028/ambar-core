output "nlb_arn" {
  value = aws_lb.ledger.arn
}

output "nlb_dns_name" {
  value = aws_lb.ledger.dns_name
}

output "ecr_repository_url" {
  value = aws_ecr_repository.ledger.repository_url
}

output "ecr_repository_arn" {
  value = aws_ecr_repository.ledger.arn
}

output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "service_name" {
  value = aws_ecs_service.ledger.name
}

output "ledger_task_family" {
  value = aws_ecs_task_definition.ledger.family
}

output "migrate_task_family" {
  value = aws_ecs_task_definition.migrate.family
}

output "execution_role_arn" {
  value = aws_iam_role.execution.arn
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.ledger.name
}

output "relay_service_name" {
  value = one(aws_ecs_service.relay[*].name)
}

output "relay_task_family" {
  value = one(aws_ecs_task_definition.relay[*].family)
}

output "relay_task_role_arn" {
  value = one(aws_iam_role.relay[*].arn)
}

output "nlb_security_group_id" {
  value = aws_security_group.nlb.id
}
