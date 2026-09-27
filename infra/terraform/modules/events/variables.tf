variable "name" {
  description = "Prefijo de nombres, p. ej. ambar-dev"
  type        = string
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

variable "n8n_base_url" {
  description = "URL interna de n8n (Cloud Map), p. ej. http://n8n.ambar-dev.internal:5678"
  type        = string
}

variable "n8n_port" {
  type    = number
  default = 5678
}

variable "routes" {
  description = "Flujo de n8n → tipos de evento que recibe. Debe coincidir con ROUTES de packages/events."
  type        = map(list(string))
  default = {
    "onboarding"       = ["account.opened"]
    "movimientos"      = ["transfer.posted", "deposit.posted"]
    "alerta-fraude"    = ["transfer.posted"]
    "fraude-respuesta" = ["fraud_case.answered"]
  }
}

variable "max_receive_count" {
  description = "Intentos de entrega antes de mandar el mensaje a la DLQ del flujo"
  type        = number
  default     = 5
}

variable "archive_retention_days" {
  description = "Días que EventBridge conserva todos los eventos del core para reproducirlos (replay)"
  type        = number
  default     = 30
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "alarm_topic_arns" {
  description = "Tópicos SNS que reciben la alarma de mensajes en DLQ"
  type        = list(string)
  default     = []
}
