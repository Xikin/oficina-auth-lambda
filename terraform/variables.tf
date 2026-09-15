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

variable "jwt_cliente_secret" {
  description = <<-EOT
    Segredo do emissor de tokens de CLIENTE.
    Precisa ser IDÊNTICO ao JWT_CLIENTE_SECRET da API e DIFERENTE do JWT_SECRET
    dela — a API recusa tokens deste emissor que aleguem qualquer papel além de
    CLIENTE (ADR-0011 em oficina-mvp). Fornecido via TF_VAR_jwt_cliente_secret.
  EOT
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.jwt_cliente_secret) >= 32
    error_message = "JWT_CLIENTE_SECRET deve ter no mínimo 32 caracteres."
  }
}

variable "lambda_reserved_concurrency" {
  description = <<-EOT
    Teto de execuções simultâneas da função. Sem ele, uma força bruta de CPF
    escala até o limite da conta e esgota as conexões do db.t3.micro,
    derrubando a API junto. Use -1 para remover a reserva: a AWS exige manter
    10 execuções não reservadas, o que falha em contas com cota baixa.
  EOT
  type        = number
  default     = 10

  validation {
    condition     = var.lambda_reserved_concurrency == -1 || var.lambda_reserved_concurrency >= 1
    error_message = "Use -1 (sem reserva) ou um valor maior ou igual a 1."
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

variable "new_relic_license_key" {
  description = "License key (INGEST - LICENSE) do New Relic. Vazia, os logs da função e do gateway ficam só no CloudWatch."
  type        = string
  default     = ""
  sensitive   = true
}

variable "new_relic_log_api_url" {
  description = "Endpoint da Log API do New Relic (região US)"
  type        = string
  default     = "https://log-api.newrelic.com/log/v1"
}

variable "encaminhador_zip_path" {
  description = "Caminho do artefato do encaminhador de logs gerado por `npm run package`"
  type        = string
  default     = "../encaminhador-logs.zip"
}
