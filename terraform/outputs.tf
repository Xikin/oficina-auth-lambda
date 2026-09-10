output "api_gateway_url" {
  description = "URL base da plataforma — é este endereço que vai no README, no Postman e no vídeo"
  value       = aws_apigatewayv2_stage.this.invoke_url
}

output "auth_endpoint" {
  description = "Endpoint de autenticação por CPF"
  value       = "${aws_apigatewayv2_stage.this.invoke_url}auth/cpf"
}

output "lambda_function_name" {
  description = "Nome da função para uso com `aws lambda invoke` e `aws logs tail`"
  value       = aws_lambda_function.auth.function_name
}

output "lambda_log_group" {
  description = "Log group da função no CloudWatch"
  value       = aws_cloudwatch_log_group.lambda.name
}

output "gateway_log_group" {
  description = "Log group de acesso do API Gateway"
  value       = aws_cloudwatch_log_group.gateway.name
}

output "api_backend" {
  description = "Backend para onde o gateway roteia as rotas da aplicação"
  value       = local.api_endpoint
}

output "exemplo_curl" {
  description = "Comando pronto para demonstrar a autenticação por CPF"
  value       = <<-EOT
    curl -sS -X POST ${aws_apigatewayv2_stage.this.invoke_url}auth/cpf \
      -H 'content-type: application/json' \
      -d '{"cpf":"529.982.247-25"}'
  EOT
}
