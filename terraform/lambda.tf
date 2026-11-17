resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.name}-auth"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "auth" {
  function_name = "${local.name}-auth"
  description   = "Valida CPF, identifica o cliente no OS Service e emite JWT"

  role    = data.aws_iam_role.lab.arn
  runtime = "nodejs22.x"
  handler = "index.handler"

  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)

  memory_size = var.lambda_memory_mb
  timeout     = var.lambda_timeout_s

  reserved_concurrent_executions = var.lambda_reserved_concurrency

  environment {
    variables = {
      OS_SERVICE_URL     = "http://${local.endpoints["os"]}"
      INTEGRACAO_API_KEY = data.aws_ssm_parameter.integracao_api_key.value
      JWT_CLIENTE_SECRET = var.jwt_cliente_secret
      JWT_EXPIRES_IN     = var.jwt_expires_in
      APP_ENV            = var.environment
    }
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.lambda.name
  }

  tracing_config {
    mode = "Active"
  }

  depends_on = [aws_cloudwatch_log_group.lambda]
}
