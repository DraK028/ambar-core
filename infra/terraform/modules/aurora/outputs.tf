output "cluster_endpoint" {
  description = "Endpoint de escritura"
  value       = aws_rds_cluster.this.endpoint
}

output "reader_endpoint" {
  description = "Endpoint de lectura (vista analítica, conciliación)"
  value       = aws_rds_cluster.this.reader_endpoint
}

output "master_secret_arn" {
  description = "Secreto de Secrets Manager con la contraseña maestra"
  value       = aws_rds_cluster.this.master_user_secret[0].secret_arn
}

output "security_group_id" {
  value = aws_security_group.aurora.id
}

output "kms_key_arn" {
  value = aws_kms_key.aurora.arn
}

output "cluster_resource_id" {
  description = "Para la política rds-db:connect de autenticación IAM"
  value       = aws_rds_cluster.this.cluster_resource_id
}
