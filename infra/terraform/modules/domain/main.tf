terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.95"
    }
  }
}

variable "domain_name" {
  description = "Dominio de la banca web, p. ej. ambar.midominio.com"
  type        = string
}

variable "zone_id" {
  description = "Hosted zone pública de Route 53 que contiene el dominio"
  type        = string
}

locals {
  api_domain    = "api.${var.domain_name}"
  internal_host = "ledger.internal.${var.domain_name}"
}

# Un solo certificado público para los tres nombres. Debe estar en us-east-1 porque
# CloudFront solo acepta certificados de esa región (el entorno dev ya vive ahí).
resource "aws_acm_certificate" "this" {
  domain_name               = var.domain_name
  subject_alternative_names = [local.api_domain, local.internal_host]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "validation" {
  for_each = {
    for o in aws_acm_certificate.this.domain_validation_options : o.domain_name => {
      name   = o.resource_record_name
      type   = o.resource_record_type
      record = o.resource_record_value
    }
  }

  zone_id         = var.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}

output "certificate_arn" {
  value = aws_acm_certificate_validation.this.certificate_arn
}

output "web_domain" {
  value = var.domain_name
}

output "api_domain" {
  value = local.api_domain
}

output "internal_host" {
  description = "Nombre del NLB interno en el certificado; API Gateway lo usa para validar TLS"
  value       = local.internal_host
}

output "zone_id" {
  value = var.zone_id
}
