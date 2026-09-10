# ADR-0006: Segredos injetados no deploy, não lidos em runtime

**Status:** Aceita
**Data:** 2026-09-09

## Contexto

A Lambda de autenticação precisa de dois segredos: a `DATABASE_URL` do RDS e o
`JWT_SECRET` compartilhado com a API. O padrão recomendado pela AWS é buscá-los em
runtime no Secrets Manager ou no SSM Parameter Store, para que a rotação não exija
redeploy.

Esse padrão não funciona neste desenho. A função roda nas **subnets privadas**, que
por decisão de custo **não têm NAT Gateway** (ver
[ADR-0005](https://github.com/Xikin/oficina-infra-k8s/blob/main/docs/adr/0005-restricoes-aws-academy.md)).
Uma Lambda dentro da VPC só alcança a internet por NAT, e só alcança serviços da AWS
sem NAT através de **VPC Endpoints de interface** — que custam ~US$0,24/dia cada, e
seriam necessários dois (SSM e KMS).

Somando NAT ou endpoints, o custo fixo mensal ultrapassaria o crédito do Learner Lab
antes da data de entrega.

## Decisão

O Terraform **lê** os segredos do SSM no momento do `apply` e os **injeta como
variáveis de ambiente** da função:

```hcl
environment {
  variables = {
    DATABASE_URL = data.aws_ssm_parameter.database_url.value  # SecureString, decifrada no apply
    JWT_SECRET   = var.jwt_secret                             # TF_VAR_jwt_secret no pipeline
  }
}
```

As variáveis de ambiente da Lambda são criptografadas em repouso com a chave KMS
gerenciada da AWS por padrão.

## Consequências

**Positivas**
- Zero custo fixo de rede: nem NAT, nem VPC Endpoint.
- Zero latência de runtime: sem chamada a serviço externo no caminho quente da
  autenticação — relevante num endpoint de login.
- Sem dependência de disponibilidade do SSM durante a invocação.

**Negativas**
- **Rotacionar um segredo exige `terraform apply`.** Não é rotação automática.
- O valor decifrado passa pelo **state do Terraform**. O state fica em bucket S3
  privado, criptografado e com versionamento — mas quem lê o state lê o segredo.
- Alguém com `lambda:GetFunctionConfiguration` vê a `DATABASE_URL` no console.

**Mitigação adotada**
- Bucket de state com `BlockPublicAcls`, SSE e acesso restrito à conta.
- Senha do banco gerada pelo Terraform e nunca impressa em log de pipeline (o
  workflow imprime apenas o *nome* do parâmetro SSM, nunca o valor).
- `JWT_SECRET` entra por `TF_VAR_jwt_secret` a partir de um secret do GitHub,
  nunca versionado.

## Reavaliar se

O projeto sair do Learner Lab para uma conta com orçamento real. Nesse caso, a
evolução natural é: adicionar VPC Endpoints de interface para SSM e KMS, trocar as
variáveis de ambiente por leitura em runtime com cache em memória, e habilitar
rotação automática do segredo do banco no Secrets Manager.
