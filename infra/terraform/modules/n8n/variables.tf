variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "cluster_arn" {
  description = "Cluster de ECS del core (se comparte con el Ledger)"
  type        = string
}

variable "image_tag" {
  type    = string
  default = "bootstrap"
}

variable "port" {
  type    = number
  default = 5678
}

variable "allowed_security_group_ids" {
  description = "Quién puede llamar los webhooks de n8n (el forwarder)"
  type        = list(string)
}

variable "core_url" {
  description = "URL interna del Ledger (NLB), p. ej. http://<nlb-dns>"
  type        = string
}

variable "token_endpoint" {
  description = "Endpoint /oauth2/token de Cognito"
  type        = string
}

variable "client_id" {
  description = "App client de Cognito de la automatización (client credentials)"
  type        = string
}

variable "client_secret" {
  type      = string
  sensitive = true
}

variable "webhook_secret_arn" {
  description = "Secreto HMAC compartido con el forwarder"
  type        = string
}

variable "ops_webhook_url" {
  description = "Webhook de Slack/Teams para alertas de operación (opcional)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "push_enabled" {
  type    = bool
  default = false
}

variable "fraud_score_threshold" {
  type    = number
  default = 60
}

variable "cpu" {
  type    = number
  default = 512
}

variable "memory" {
  type    = number
  default = 1024
}

variable "use_spot" {
  type    = bool
  default = false
}

variable "log_retention_days" {
  type    = number
  default = 30
}
