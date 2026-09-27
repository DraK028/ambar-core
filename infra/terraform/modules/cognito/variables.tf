variable "name" {
  description = "Prefijo de nombres, p. ej. ambar-dev"
  type        = string
}

variable "deletion_protection" {
  description = "true en prod: evita borrar el user pool por accidente"
  type        = bool
  default     = false
}

variable "mfa_configuration" {
  description = "OFF, OPTIONAL u ON. En prod: ON."
  type        = string
  default     = "OPTIONAL"
}

variable "allow_self_signup" {
  description = "Permite que los usuarios se registren solos desde la página de Cognito"
  type        = bool
  default     = true
}

variable "web_callback_urls" {
  description = "URLs de retorno del BFF web tras el login"
  type        = list(string)
  default     = ["http://localhost:3001/api/auth/callback"]
}

variable "web_logout_urls" {
  type    = list(string)
  default = ["http://localhost:3001/"]
}

variable "cli_callback_urls" {
  description = "Callback local de tools/cognito-login.mjs y de la consola de operación"
  type        = list(string)
  default     = ["http://localhost:8765/callback"]
}

variable "enable_dev_clients" {
  description = "Crea los clientes de CLI y de automatización de QA (nunca en prod)"
  type        = bool
  default     = true
}
