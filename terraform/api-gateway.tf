# ---------------------------------------------------------------------------
# API Gateway (HTTP API)
#
# Ponto único de entrada da plataforma. Duas rotas:
#
#   POST /auth/cpf   -> Lambda de autenticação (pública, sem token)
#   $default         -> proxy HTTP para o Load Balancer da API no EKS
#
# HTTP API e não REST API: ~70% mais barato, latência menor e CORS nativo.
# O que perdemos (request validators, API keys, WAF direto) não é exigido aqui.
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_api" "this" {
  name          = "${local.name}-gateway"
  description   = "Gateway da Oficina Mecanica - autenticacao por CPF e roteamento da API"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = var.cors_allow_origins
    allow_methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    allow_headers = ["content-type", "authorization", "x-request-id"]
    # Deixa o cliente ler o id de correlação da resposta.
    expose_headers = ["x-request-id"]
    max_age        = 300
  }
}

# ---- Rota pública de autenticação -----------------------------------------

resource "aws_apigatewayv2_integration" "auth_lambda" {
  api_id = aws_apigatewayv2_api.this.id

  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.auth.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = var.lambda_timeout_s * 1000
}

resource "aws_apigatewayv2_route" "auth_cpf" {
  api_id    = aws_apigatewayv2_api.this.id
  route_key = "POST /auth/cpf"
  target    = "integrations/${aws_apigatewayv2_integration.auth_lambda.id}"
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowInvokeFromApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auth.function_name
  principal     = "apigateway.amazonaws.com"

  # Restringe a invocação a ESTE gateway, e não a qualquer API da conta.
  source_arn = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}

# ---- Roteamento para a aplicação no cluster --------------------------------

resource "aws_apigatewayv2_integration" "api_proxy" {
  api_id = aws_apigatewayv2_api.this.id

  integration_type   = "HTTP_PROXY"
  integration_method = "ANY"
  # {proxy} preserva o path completo: /clientes/123 chega como /clientes/123.
  integration_uri      = "http://${local.api_endpoint}/{proxy}"
  timeout_milliseconds = 29000

  request_parameters = {
    # Propaga o id de correlação para a API, fechando o rastro
    # gateway -> aplicação -> log.
    "overwrite:header.x-request-id" = "$context.requestId"
  }
}

resource "aws_apigatewayv2_route" "api_proxy" {
  api_id    = aws_apigatewayv2_api.this.id
  route_key = "ANY /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.api_proxy.id}"
}

# ---- Stage ----------------------------------------------------------------

resource "aws_cloudwatch_log_group" "gateway" {
  name              = "/aws/apigateway/${local.name}"
  retention_in_days = var.log_retention_days
}

resource "aws_apigatewayv2_stage" "this" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    # Freio contra força bruta de CPF na rota de autenticação.
    throttling_burst_limit   = var.throttling_burst_limit
    throttling_rate_limit    = var.throttling_rate_limit
    detailed_metrics_enabled = true
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.gateway.arn

    # JSON de uma linha: é o formato que o New Relic e o CloudWatch Logs
    # Insights conseguem consultar por campo sem regex.
    format = jsonencode({
      requestId         = "$context.requestId"
      correlationId     = "$context.requestId"
      ip                = "$context.identity.sourceIp"
      requestTime       = "$context.requestTime"
      httpMethod        = "$context.httpMethod"
      routeKey          = "$context.routeKey"
      path              = "$context.path"
      status            = "$context.status"
      protocol          = "$context.protocol"
      responseLength    = "$context.responseLength"
      latenciaMs        = "$context.responseLatency"
      integrationError  = "$context.integration.error"
      integrationStatus = "$context.integration.status"
    })
  }
}
