variable "name" {
  description = "Prefijo de nombres, p. ej. ambar-dev"
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "db_subnet_group_name" {
  description = "Grupo de subredes aisladas (sin ruta a internet)"
  type        = string
}

variable "allowed_security_group_ids" {
  description = "Security groups que pueden conectarse a Postgres (tareas de ECS, bastión de migraciones)"
  type        = list(string)
  default     = []
}

variable "engine_version" {
  description = "Versión de Aurora PostgreSQL; 16.3 o mayor permite escalar a 0 ACU"
  type        = string
  default     = "16.6"
}

variable "min_acu" {
  description = "Capacidad mínima. 0 pausa el cluster sin conexiones (solo fuera de prod)."
  type        = number
  default     = 0
}

variable "max_acu" {
  type    = number
  default = 2
}

variable "seconds_until_auto_pause" {
  description = "Segundos sin conexiones antes de pausar cuando min_acu = 0"
  type        = number
  default     = 1800
}

variable "instance_count" {
  description = "Instancias del cluster. En prod, al menos 2 en distintas AZ."
  type        = number
  default     = 1
}

variable "backup_retention_days" {
  type    = number
  default = 7
}

variable "deletion_protection" {
  description = "true en prod: impide borrar el cluster y exige snapshot final"
  type        = bool
  default     = false
}
