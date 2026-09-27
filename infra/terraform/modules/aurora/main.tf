terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.95"
    }
  }
}

# Llave propia para Aurora, snapshots y el secreto de la contraseña maestra.
resource "aws_kms_key" "aurora" {
  description             = "${var.name} Aurora (ledger)"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "aurora" {
  name          = "alias/${var.name}-aurora"
  target_key_id = aws_kms_key.aurora.key_id
}

resource "aws_security_group" "aurora" {
  name        = "${var.name}-aurora"
  description = "Postgres solo desde los servicios autorizados"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "from_apps" {
  for_each                     = toset(var.allowed_security_group_ids)
  security_group_id            = aws_security_group.aurora.id
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "Postgres desde ${each.value}"
}

resource "aws_rds_cluster_parameter_group" "this" {
  name        = "${var.name}-aurora-pg16"
  family      = "aurora-postgresql16"
  description = "Parámetros de Ámbar: TLS obligatorio y registro de consultas lentas"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }

  parameter {
    name  = "idle_in_transaction_session_timeout"
    value = "30000"
  }
}

resource "aws_rds_cluster" "this" {
  cluster_identifier = "${var.name}-ledger"
  engine             = "aurora-postgresql"
  engine_mode        = "provisioned"
  engine_version     = var.engine_version
  database_name      = "ambar"
  master_username    = "ambar_admin"

  # La contraseña la genera y rota RDS en Secrets Manager; nunca pasa por Terraform.
  manage_master_user_password   = true
  master_user_secret_kms_key_id = aws_kms_key.aurora.arn

  db_subnet_group_name            = var.db_subnet_group_name
  vpc_security_group_ids          = [aws_security_group.aurora.id]
  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.this.name

  storage_encrypted                   = true
  kms_key_id                          = aws_kms_key.aurora.arn
  iam_database_authentication_enabled = true

  serverlessv2_scaling_configuration {
    min_capacity             = var.min_acu
    max_capacity             = var.max_acu
    seconds_until_auto_pause = var.min_acu == 0 ? var.seconds_until_auto_pause : null
  }

  backup_retention_period         = var.backup_retention_days
  preferred_backup_window         = "08:00-09:00" # 02:00-03:00 hora del centro de México
  copy_tags_to_snapshot           = true
  deletion_protection             = var.deletion_protection
  skip_final_snapshot             = !var.deletion_protection
  final_snapshot_identifier       = var.deletion_protection ? "${var.name}-ledger-final" : null
  enabled_cloudwatch_logs_exports = ["postgresql"]
  apply_immediately               = !var.deletion_protection
}

resource "aws_rds_cluster_instance" "this" {
  count                        = var.instance_count
  identifier                   = "${var.name}-ledger-${count.index + 1}"
  cluster_identifier           = aws_rds_cluster.this.id
  engine                       = aws_rds_cluster.this.engine
  engine_version               = aws_rds_cluster.this.engine_version
  instance_class               = "db.serverless"
  performance_insights_enabled = true
  auto_minor_version_upgrade   = true
}
