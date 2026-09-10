variable "region" {
  description = "Região AWS — a mesma das stacks de rede e banco"
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Prefixo aplicado ao nome de todos os recursos"
  type        = string
  default     = "oficina"
}

variable "environment" {
  description = "Ambiente lógico (homolog ou prod)"
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["homolog", "prod"], var.environment)
    error_message = "environment deve ser 'homolog' ou 'prod'."
  }
}

variable "lab_role_name" {
  description = "Role de execução pré-existente (ver ADR-0005 em oficina-infra-k8s)"
  type        = string
  default     = "LabRole"
}

variable "lambda_zip_path" {
  description = "Caminho do artefato gerado por `npm run package`"
  type        = string
  default     = "../lambda.zip"
}

variable "lambda_memory_mb" {
  description = <<-EOT
    Memória da função. Na Lambda a CPU é proporcional à memória, então 512 MB
    reduz o cold start bem mais do que o custo aumenta — a função roda em
    dezenas de milissegundos.
  EOT
  type        = number
  default     = 512
}

variable "lambda_timeout_s" {
  description = "Timeout da função. Uma consulta ao RDS e uma assinatura JWT cabem folgadamente em 10s."
  type        = number
  default     = 10
}

variable "jwt_secret" {
  description = <<-EOT
    Segredo compartilhado com a API para assinar/validar o JWT.
    Precisa ser IDÊNTICO ao JWT_SECRET da aplicação, senão o token emitido aqui
    é rejeitado lá. Fornecido via TF_VAR_jwt_secret no pipeline.
  EOT
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.jwt_secret) >= 32
    error_message = "JWT_SECRET deve ter no mínimo 32 caracteres."
  }
}

variable "jwt_expires_in" {
  description = "Validade do token emitido para o cliente"
  type        = string
  default     = "8h"
}

variable "log_retention_days" {
  description = "Retenção dos logs da função e do gateway no CloudWatch"
  type        = number
  default     = 14
}

variable "throttling_burst_limit" {
  description = "Rajada aceita pelo API Gateway — freia força bruta de CPF"
  type        = number
  default     = 20
}

variable "throttling_rate_limit" {
  description = "Requisições por segundo em regime permanente"
  type        = number
  default     = 50
}

variable "cors_allow_origins" {
  description = "Origens aceitas pelo API Gateway"
  type        = list(string)
  default     = ["*"]
}
