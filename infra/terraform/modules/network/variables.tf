variable "name" {
  description = "Prefijo de nombres, p. ej. ambar-dev"
  type        = string
}

variable "cidr" {
  description = "Bloque CIDR de la VPC"
  type        = string
  default     = "10.20.0.0/16"
}

variable "single_nat_gateway" {
  description = "Un solo NAT Gateway (barato, sin alta disponibilidad). En prod debe ser false."
  type        = bool
  default     = true
}

variable "enable_interface_endpoints" {
  description = "Crea endpoints de interfaz (cuestan por hora y por AZ). Recomendado en staging y prod."
  type        = bool
  default     = false
}

variable "flow_log_retention_days" {
  description = "Días de retención de los VPC Flow Logs"
  type        = number
  default     = 30
}
