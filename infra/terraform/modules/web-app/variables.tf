variable "name" {
  description = "Prefijo de nombres, p. ej. ambar-dev"
  type        = string
}

variable "app_env" {
  type = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.app_env)
    error_message = "app_env debe ser dev, staging o prod."
  }
}

variable "vpc_id" {
  type = string
}

variable "vpc_cidr" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "cluster_arn" {
  description = "Cluster de ECS compartido con el Ledger"
  type        = string
}

variable "ledger_api_url" {
  description = "URL base de la API del core (API Gateway)"
  type        = string
}

variable "cognito_domain" {
  type = string
}

variable "cognito_client_id" {
  type = string
}

variable "cognito_client_secret" {
  type      = string
  sensitive = true
}

variable "cognito_issuer" {
  type = string
}

variable "domain_name" {
  description = "Dominio propio (opcional). Sin él, la web se sirve en el dominio de CloudFront."
  type        = string
  default     = null
}

variable "certificate_arn" {
  description = "Certificado de ACM en us-east-1 que cubre domain_name (obligatorio si hay dominio)"
  type        = string
  default     = null
}

variable "zone_id" {
  type    = string
  default = null
}

variable "image_tag" {
  type    = string
  default = "bootstrap"
}

variable "cpu" {
  type    = number
  default = 256
}

variable "memory" {
  type    = number
  default = 512
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "use_spot" {
  type    = bool
  default = false
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "protect_resources" {
  type    = bool
  default = false
}
