variable "name" {
  description = "Prefijo de nombres, p. ej. ambar-dev"
  type        = string
}

variable "app_env" {
  description = "Valor de APP_ENV del servicio: dev, staging o prod"
  type        = string

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

variable "private_subnet_ids" {
  type = list(string)
}

variable "task_security_group_id" {
  description = "SG de las tareas; Aurora ya permite entrada desde él"
  type        = string
}

variable "image_tag" {
  description = "Etiqueta inicial de la imagen. Los despliegues posteriores los hace el workflow."
  type        = string
  default     = "bootstrap"
}

variable "container_port" {
  type    = number
  default = 3000
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
  description = "FARGATE_SPOT (hasta 70 % más barato, puede interrumpirse). Solo fuera de prod."
  type        = bool
  default     = false
}

variable "db_host" {
  description = "Endpoint de escritura de Aurora"
  type        = string
}

variable "db_cluster_resource_id" {
  description = "Resource ID del cluster (para la política rds-db:connect)"
  type        = string
}

variable "db_app_user" {
  type    = string
  default = "ambar_app"
}

variable "db_master_secret_arn" {
  type = string
}

variable "db_kms_key_arn" {
  type = string
}

variable "cognito_issuer" {
  type = string
}

variable "cognito_client_ids" {
  type = list(string)
}

variable "enable_qa_endpoints" {
  type    = bool
  default = false
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "protect_resources" {
  description = "true en prod: protección contra borrado del NLB y del repositorio de imágenes"
  type        = bool
  default     = false
}

variable "tls_certificate_arn" {
  description = "Certificado para el listener TLS del NLB (opcional, requiere dominio propio)"
  type        = string
  default     = null
}

variable "step_up_client_ids" {
  description = "App clients cuyas transferencias exigen firma del dispositivo (la app móvil)"
  type        = list(string)
  default     = []
}

variable "step_up_threshold" {
  description = "Monto en centavos desde el cual se exige step-up ($5,000.00 por defecto)"
  type        = number
  default     = 500000
}

variable "internal_client_ids" {
  description = "App clients máquina a máquina que pueden llamar /v1/internal (n8n)"
  type        = list(string)
  default     = []
}

variable "event_bus_name" {
  description = "Bus de EventBridge donde el relay publica el outbox (null = sin relay)"
  type        = string
  default     = null
}

variable "event_bus_arn" {
  type    = string
  default = null
}

variable "db_relay_user" {
  description = "Usuario de Aurora del relay: solo lee y marca el outbox (migración 005)"
  type        = string
  default     = "ambar_relay"
}

variable "relay_desired_count" {
  description = "Réplicas del relay. Pueden ser varias: FOR UPDATE SKIP LOCKED evita publicar dos veces."
  type        = number
  default     = 1
}
