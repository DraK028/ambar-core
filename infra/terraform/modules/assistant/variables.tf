variable "name" {
  type = string
}

variable "app_env" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "vpc_cidr" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "cluster_arn" {
  type = string
}

variable "nlb_arn" {
  description = "NLB interno del core: el asistente se publica en otro puerto del mismo balanceador"
  type        = string
}

variable "nlb_security_group_id" {
  type = string
}

variable "listener_port" {
  type    = number
  default = 8080
}

variable "tls_listener_port" {
  type    = number
  default = 8443
}

variable "tls_certificate_arn" {
  type    = string
  default = null
}

variable "container_port" {
  type    = number
  default = 3002
}

variable "image_tag" {
  type    = string
  default = "bootstrap"
}

variable "core_url" {
  description = "Ledger por el NLB interno (el asistente llama con el token del usuario)"
  type        = string
}

variable "cognito_issuer" {
  type = string
}

variable "cognito_client_ids" {
  description = "Clientes que pueden usar el asistente (web, móvil)"
  type        = list(string)
}

variable "bedrock_model_id" {
  description = <<-EOT
    Modelo o perfil de inferencia de Bedrock con tool use (Converse), habilitado en la cuenta.
    Un perfil entre regiones empieza con "us.", "eu.", "apac." o "global.".
  EOT
  type        = string
}

variable "daily_message_limit" {
  type    = number
  default = 50
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
