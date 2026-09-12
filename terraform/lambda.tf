# ---------------------------------------------------------------------------
# Function serverless de autenticação por CPF
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.name}-auth"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "auth" {
  function_name = "${local.name}-auth"
  description   = "Valida CPF, consulta o cliente no RDS e emite JWT"

  role    = data.aws_iam_role.lab.arn
  runtime = "nodejs20.x"
  handler = "index.handler"

  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)

  memory_size = var.lambda_memory_mb
  timeout     = var.lambda_timeout_s

  # Limita o estrago de uma força bruta: sem teto, a função escala até o limite
  # da conta e esgota as conexões do RDS, derrubando também a API.
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  # Sem a ENI na VPC a função não alcança o RDS, que vive em subnet privada.
  vpc_config {
    subnet_ids = local.private_subnet_ids
    # SG "crachá" publicado por oficina-infra-db: quem o anexa fala com o banco.
    security_group_ids = [local.db_client_sg_id]
  }

  environment {
    variables = {
      # Ver ADR-0006: injetado no deploy em vez de lido do Secrets Manager em
      # runtime, porque a subnet privada não tem NAT nem VPC Endpoint.
      DATABASE_URL       = data.aws_ssm_parameter.database_url.value
      JWT_CLIENTE_SECRET = var.jwt_cliente_secret
      JWT_EXPIRES_IN     = var.jwt_expires_in
      APP_ENV            = var.environment
    }
  }

  logging_config {
    log_format = "JSON" # o handler já emite JSON; isso alinha os logs da plataforma
    log_group  = aws_cloudwatch_log_group.lambda.name
  }

  tracing_config {
    mode = "Active" # X-Ray: gera os traces exigidos na demonstração
  }

  depends_on = [aws_cloudwatch_log_group.lambda]
}

# Nota sobre cold start: com bundle de ~315 KB e sem Prisma, o cold start fica
# na casa de 300ms. Provisioned concurrency eliminaria isso, mas cobra por hora
# ociosa e exige versionamento da função — não compensa no escopo do desafio.
