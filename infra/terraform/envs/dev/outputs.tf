output "vpc_id" {
  value = module.network.vpc_id
}

output "aurora_endpoint" {
  value = module.aurora.cluster_endpoint
}

output "aurora_master_secret_arn" {
  value = module.aurora.master_secret_arn
}

output "core_services_security_group_id" {
  value = aws_security_group.core_services.id
}

output "ci_role_arn" {
  description = "Rol que asume GitHub Actions (secreto AWS_CI_ROLE_ARN del repositorio)"
  value       = module.github_oidc.role_arn
}

output "api_url" {
  description = "URL base de la API en dev"
  value       = module.api.invoke_url
}

output "web_url" {
  description = "Banca web en dev"
  value       = module.web.app_url
}

output "cognito" {
  description = "Datos para iniciar sesión (tools/cognito-login.mjs) y para el BFF web"
  value = {
    issuer        = module.cognito.issuer
    hosted_domain = module.cognito.hosted_domain
    user_pool_id  = module.cognito.user_pool_id
    client_ids    = module.cognito.client_ids
  }
}

output "deploy_role_arn" {
  description = "Secreto AWS_DEPLOY_ROLE_ARN del repositorio"
  value       = aws_iam_role.deploy.arn
}

output "github_variables" {
  description = "Variables del repositorio (Settings → Variables → Actions) para el workflow de despliegue"
  value = {
    AWS_REGION          = var.region
    ECR_REPOSITORY_URL  = module.ledger.ecr_repository_url
    ECS_CLUSTER         = module.ledger.cluster_name
    ECS_SERVICE         = module.ledger.service_name
    LEDGER_TASK_FAMILY  = module.ledger.ledger_task_family
    MIGRATE_TASK_FAMILY = module.ledger.migrate_task_family
    PRIVATE_SUBNETS     = join(",", module.network.private_subnet_ids)
    TASK_SECURITY_GROUP = aws_security_group.core_services.id
    WEB_ECR_REPOSITORY  = module.web.ecr_repository_url
    WEB_SERVICE         = module.web.service_name
    WEB_TASK_FAMILY     = module.web.task_family
    RELAY_SERVICE       = module.ledger.relay_service_name
    RELAY_TASK_FAMILY   = module.ledger.relay_task_family
    N8N_ECR_REPOSITORY  = module.n8n.ecr_repository_url
    N8N_SERVICE         = module.n8n.service_name
    N8N_TASK_FAMILY     = module.n8n.task_family
    FORWARDER_FUNCTION  = module.events.forwarder_function_name
    ASSISTANT_ECR       = module.assistant.ecr_repository_url
    ASSISTANT_SERVICE   = module.assistant.service_name
    ASSISTANT_FAMILY    = module.assistant.task_family
  }
}

output "events" {
  description = "Bus de eventos y DLQ por flujo de n8n"
  value = {
    bus_name = module.events.bus_name
    dlq_urls = module.events.dlq_urls
    n8n_url  = module.n8n.internal_url
  }
}

output "assistant" {
  description = "Guardrail y tabla del asistente (para correr las evaluaciones contra Bedrock)"
  value = {
    guardrail_id        = module.assistant.guardrail_id
    guardrail_version   = module.assistant.guardrail_version
    conversations_table = module.assistant.conversations_table
  }
}
