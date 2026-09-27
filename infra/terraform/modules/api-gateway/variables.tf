variable "name" {
  description = "Prefijo de nombres, p. ej. ambar-dev"
  type        = string
}

variable "stage_name" {
  type    = string
  default = "dev"
}

variable "nlb_arn" {
  description = "NLB interno del Ledger (destino del VPC Link)"
  type        = string
}

variable "nlb_dns_name" {
  type = string
}

variable "user_pool_arn" {
  type = string
}

variable "api_scopes" {
  description = "El token debe traer al menos uno de estos scopes (el Ledger valida el exacto por ruta)"
  type        = list(string)
}

variable "throttle_rate_limit" {
  description = "Solicitudes por segundo en estado estable para todo el stage"
  type        = number
  default     = 50
}

variable "throttle_burst_limit" {
  type    = number
  default = 100
}

variable "enable_waf" {
  description = "WAF cuesta ~USD 5/mes más USD 1 por regla. Recomendado en staging y prod."
  type        = bool
  default     = false
}

variable "waf_rate_limit_per_5min" {
  description = "Solicitudes por IP en 5 minutos antes de bloquear"
  type        = number
  default     = 500
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "manage_account_role" {
  description = "Crea el rol de CloudWatch de API Gateway para la cuenta/región. false si ya existe."
  type        = bool
  default     = true
}

variable "backend_tls_hostname" {
  description = "Nombre en el certificado del NLB; si se define, API Gateway llega al Ledger por TLS"
  type        = string
  default     = null
}

variable "api_domain_name" {
  description = "Dominio propio de la API, p. ej. api.ambar.midominio.com (opcional)"
  type        = string
  default     = null
}

variable "certificate_arn" {
  type    = string
  default = null
}

variable "zone_id" {
  type    = string
  default = null
}

variable "enable_assistant" {
  description = "Publica /v1/assistant/* hacia el servicio del asistente (listener aparte del NLB)"
  type        = bool
  default     = false
}

variable "assistant_port" {
  description = "Puerto del NLB para el asistente sin TLS"
  type        = number
  default     = 8080
}

variable "assistant_tls_port" {
  description = "Puerto del NLB para el asistente con TLS (cuando hay backend_tls_hostname)"
  type        = number
  default     = 8443
}

variable "assistant_scopes" {
  description = "Scopes que exige API Gateway en /v1/assistant (p. ej. ambar-api/assistant.chat)"
  type        = list(string)
  default     = []
}
