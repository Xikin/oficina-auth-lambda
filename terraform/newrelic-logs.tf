locals {
  encaminhar_logs = nonsensitive(var.new_relic_license_key != "")

  grupos_encaminhados = local.encaminhar_logs ? {
    lambda  = aws_cloudwatch_log_group.lambda
    gateway = aws_cloudwatch_log_group.gateway
  } : {}
}

resource "aws_cloudwatch_log_group" "encaminhador_logs" {
  count = local.encaminhar_logs ? 1 : 0

  name              = "/aws/lambda/${local.name}-newrelic-logs"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "encaminhador_logs" {
  count = local.encaminhar_logs ? 1 : 0

  function_name = "${local.name}-newrelic-logs"
  description   = "Encaminha ao New Relic os logs da função de autenticação e do API Gateway"

  role    = data.aws_iam_role.lab.arn
  runtime = "nodejs20.x"
  handler = "index.handler"

  filename         = var.encaminhador_zip_path
  source_code_hash = filebase64sha256(var.encaminhador_zip_path)

  memory_size = 256
  timeout     = 30

  environment {
    variables = {
      NEW_RELIC_LICENSE_KEY = var.new_relic_license_key
      NEW_RELIC_LOG_API     = var.new_relic_log_api_url
    }
  }

  depends_on = [aws_cloudwatch_log_group.encaminhador_logs]
}

resource "aws_lambda_permission" "cloudwatch_logs" {
  for_each = local.grupos_encaminhados

  statement_id  = "AllowCloudWatchLogs-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.encaminhador_logs[0].function_name
  principal     = "logs.amazonaws.com"
  source_arn    = "${each.value.arn}:*"
}

resource "aws_cloudwatch_log_subscription_filter" "new_relic" {
  for_each = local.grupos_encaminhados

  name            = "${local.name}-new-relic-${each.key}"
  log_group_name  = each.value.name
  filter_pattern  = ""
  destination_arn = aws_lambda_function.encaminhador_logs[0].arn

  depends_on = [aws_lambda_permission.cloudwatch_logs]
}
