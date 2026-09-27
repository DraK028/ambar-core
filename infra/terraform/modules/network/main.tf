terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.95"
    }
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 3)
}

# VPC en 3 zonas con tres niveles de subred:
#   públicas  → ALB y NAT Gateway
#   privadas  → tareas de ECS Fargate (salida a internet por NAT)
#   database  → Aurora y Redis, sin ruta a internet
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.21"

  name = "${var.name}-vpc"
  cidr = var.cidr
  azs  = local.azs

  public_subnets   = [for i in range(3) : cidrsubnet(var.cidr, 8, i)]
  private_subnets  = [for i in range(3) : cidrsubnet(var.cidr, 6, i + 1)]
  database_subnets = [for i in range(3) : cidrsubnet(var.cidr, 8, i + 100)]

  enable_nat_gateway     = true
  single_nat_gateway     = var.single_nat_gateway
  one_nat_gateway_per_az = !var.single_nat_gateway

  create_database_subnet_group           = true
  create_database_subnet_route_table     = true
  create_database_internet_gateway_route = false
  create_database_nat_gateway_route      = false

  enable_dns_hostnames = true
  enable_dns_support   = true

  # Bitácora de tráfico de red para auditoría y detección.
  enable_flow_log                                 = true
  create_flow_log_cloudwatch_log_group            = true
  create_flow_log_cloudwatch_iam_role             = true
  flow_log_cloudwatch_log_group_retention_in_days = var.flow_log_retention_days
  flow_log_max_aggregation_interval               = 60

  manage_default_security_group  = true
  default_security_group_ingress = []
  default_security_group_egress  = []
}

resource "aws_security_group" "endpoints" {
  count       = var.enable_interface_endpoints ? 1 : 0
  name        = "${var.name}-vpce"
  description = "HTTPS hacia los VPC endpoints de interfaz desde la VPC"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description = "HTTPS desde la VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.cidr]
  }
}

# Endpoints: el tráfico a S3, DynamoDB y (opcionalmente) ECR, Secrets Manager,
# CloudWatch Logs y Bedrock no sale a internet.
module "endpoints" {
  source  = "terraform-aws-modules/vpc/aws//modules/vpc-endpoints"
  version = "~> 5.21"

  vpc_id = module.vpc.vpc_id

  endpoints = merge(
    {
      s3 = {
        service         = "s3"
        service_type    = "Gateway"
        route_table_ids = concat(module.vpc.private_route_table_ids, module.vpc.database_route_table_ids)
        tags            = { Name = "${var.name}-s3" }
      }
      dynamodb = {
        service         = "dynamodb"
        service_type    = "Gateway"
        route_table_ids = module.vpc.private_route_table_ids
        tags            = { Name = "${var.name}-dynamodb" }
      }
    },
    var.enable_interface_endpoints ? {
      for svc in ["ecr.api", "ecr.dkr", "secretsmanager", "logs", "kms", "bedrock-runtime"] :
      replace(svc, ".", "_") => {
        service             = svc
        private_dns_enabled = true
        subnet_ids          = module.vpc.private_subnets
        security_group_ids  = [aws_security_group.endpoints[0].id]
        tags                = { Name = "${var.name}-${svc}" }
      }
    } : {}
  )
}
