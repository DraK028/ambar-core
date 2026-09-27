variable "region" {
  type    = string
  default = "us-east-1"
}

variable "owner" {
  description = "Responsable de los recursos (etiqueta Owner)"
  type        = string
}

variable "github_repository" {
  description = "Repositorio que puede asumir el rol de CI, formato dueño/repo"
  type        = string
}

variable "monthly_budget_usd" {
  description = "Presupuesto mensual antes de alertar (dev completo encendido cuesta ~USD 75)"
  type        = number
  default     = 80
}

variable "budget_alert_email" {
  description = "Correo que recibe la alerta de presupuesto"
  type        = string
}

variable "enable_waf" {
  description = "WAF en el stage de API Gateway (~USD 9/mes con 4 reglas)"
  type        = bool
  default     = false
}

variable "manage_apigw_account_role" {
  description = "false si la cuenta ya tiene configurado el rol de CloudWatch de API Gateway"
  type        = bool
  default     = true
}

variable "domain_name" {
  description = "Dominio propio para la banca web, p. ej. ambar.midominio.com. Vacío: se usa el dominio de CloudFront."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Hosted zone pública que contiene domain_name (solo si hay dominio)"
  type        = string
  default     = ""
}

variable "ops_webhook_url" {
  description = "Webhook entrante de Slack/Teams para alertas de n8n (opcional). Pásalo con TF_VAR_ops_webhook_url."
  type        = string
  default     = ""
  sensitive   = true
}

variable "push_enabled" {
  description = "Enviar push por Expo desde n8n (requiere un proyecto de EAS en la app)"
  type        = bool
  default     = false
}

variable "assistant_model_id" {
  description = <<-EOT
    Modelo de Bedrock para el asistente: id o perfil de inferencia de un modelo con tool use
    (API Converse) que tengas habilitado en Bedrock → Model access. Consulta los ids con
    `aws bedrock list-inference-profiles`.
  EOT
  type        = string
}
