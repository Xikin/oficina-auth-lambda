terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.64"
    }
  }

  backend "s3" {
    key          = "auth-lambda/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
      Repository  = "oficina-auth-lambda"
    }
  }
}

locals {
  name       = "${var.project}-${var.environment}"
  ssm_prefix = "/${var.project}/${var.environment}"
}

data "aws_iam_role" "lab" {
  name = var.lab_role_name
}

data "aws_ssm_parameter" "endpoint" {
  for_each = toset(["os", "execucao", "billing"])
  name     = "${local.ssm_prefix}/${each.key}/endpoint"
}

data "aws_ssm_parameter" "integracao_api_key" {
  name            = "${local.ssm_prefix}/auth/integracao_api_key"
  with_decryption = true
}

locals {
  endpoints = { for servico, p in data.aws_ssm_parameter.endpoint : servico => p.insecure_value }

  rotas_por_servico = {
    execucao = ["execucoes", "servicos", "pecas"]
    billing  = ["orcamentos", "pagamentos"]
  }

  rotas = merge([
    for servico, prefixos in local.rotas_por_servico : merge([
      for prefixo in prefixos : {
        "${prefixo}"       = { servico = servico, rota = "ANY /${prefixo}", caminho = "/${prefixo}" }
        "${prefixo}-proxy" = { servico = servico, rota = "ANY /${prefixo}/{proxy+}", caminho = "/${prefixo}/{proxy}" }
      }
    ]...)
  ]...)
}
