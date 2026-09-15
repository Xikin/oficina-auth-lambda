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

# ---------------------------------------------------------------------------
# Contratos vindos das outras stacks
# ---------------------------------------------------------------------------

data "aws_ssm_parameter" "private_subnet_ids" {
  name = "${local.ssm_prefix}/network/private_subnet_ids"
}

data "aws_ssm_parameter" "db_client_security_group_id" {
  name = "${local.ssm_prefix}/db/client_security_group_id"
}

data "aws_ssm_parameter" "database_url" {
  name            = "${local.ssm_prefix}/db/database_url"
  with_decryption = true
}

# Preenchido pelo pipeline de deploy da API depois que o Load Balancer sobe.
data "aws_ssm_parameter" "api_endpoint" {
  name = "${local.ssm_prefix}/api/endpoint"
}

locals {
  private_subnet_ids = split(",", data.aws_ssm_parameter.private_subnet_ids.value)
  db_client_sg_id    = data.aws_ssm_parameter.db_client_security_group_id.value
  api_endpoint       = data.aws_ssm_parameter.api_endpoint.value
}
