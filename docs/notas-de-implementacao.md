# Notas de implementação

O código deste repositório não tem comentários. O que não dá para deduzir lendo o código — o porquê de uma
escolha, restrições externas, contratos com os outros repositórios — fica registrado aqui, organizado por
arquivo.

---

## Código da função

### `src/handler.ts`

- O segredo usado para assinar é o `JWT_CLIENTE_SECRET`, exclusivo do emissor de clientes. **Não** é o
  `JWT_SECRET` da API: com um segredo compartilhado, quem lesse a configuração desta função forjaria tokens de
  ADMIN ([ADR-0011 em oficina-mvp](https://github.com/Xikin/tech_challenge/blob/main/docs/adr/0011-segredos-jwt-por-emissor.md)).
- Falha de rede, timeout ou chave recusada pelo OS Service cai no `catch` e responde 503, que sinaliza ao chamador
  que vale tentar de novo, ao contrário de um 500 genérico. O motivo detalhado fica só no log.

### `src/clientes.ts`

- Substitui o antigo `db.ts` (Fase 4): a função não lê mais a tabela `clientes`, pergunta ao OS Service, que é o dono
  do dado ([ADR-0013 em oficina-mvp](https://github.com/Xikin/tech_challenge/blob/main/docs/adr/0013-divisao-em-tres-microsservicos.md)).
- `POST` com o CPF no corpo, não na URL: CPF em caminho apareceria no access log do Load Balancer e do serviço.
- `x-api-key` = `INTEGRACAO_API_KEY`, gerada pelo pipeline do OS Service no SSM e lida pelo Terraform daqui. O
  `x-request-id` é repassado para a chamada aparecer correlacionada nos logs do OS Service.
- Timeout de 3 s (`OS_SERVICE_TIMEOUT_MS`): melhor falhar rápido com 503 do que segurar a invocação até o timeout
  de 10 s da função.
- 404 do OS Service vira `null` (cliente não cadastrado); qualquer outro status vira erro de indisponibilidade.

### `src/cpf.ts`

- `validarCPF` é uma cópia intencional do validador de oficina-mvp, sem o ramo de CNPJ: aceitar 14 dígitos abriria
  a autenticação de pessoa física para documento de pessoa jurídica. Um pacote compartilhado acoplaria o release da
  Lambda ao da API por um algoritmo que não muda.
- Rejeita tamanho errado e as 10 sequências repetidas (000…, 111…), que passam no cálculo do dígito verificador,
  mas nunca são emitidas.
- `mascararCPF` prepara o CPF para log: `123.456.789-09` → `***.***.789-09`.

### `src/token.ts`

O payload segue o mesmo contrato do token do login interno da API (`sub`, `email`, `role`), com `cpf` e `nome` a
mais. `email` é opcional porque `Cliente.email` é nullable.

### `src/logger.ts`

- Mesmo formato de linha da API (pino), para que o New Relic correlacione as duas pontas do fluxo de autenticação
  pelo `requestId`.
- Nunca passe CPF, senha ou token ao logger — use `mascararCPF` antes.
- `warn` e `error` vão para stderr: o CloudWatch e o New Relic distinguem os streams.

### `src/encaminhador-logs.ts`

Função separada que leva ao New Relic os logs que ficam no CloudWatch: os da função de autenticação e o access
log do API Gateway.

- **Por que uma função própria.** A função de autenticação roda em subnet privada, sem NAT, e não alcança a
  internet; a extensão do New Relic para Lambda não conseguiria enviar nada de dentro dela. O encaminhador oficial do
  New Relic e o Kinesis Firehose exigem criar IAM roles, o que o Learner Lab não permite. Esta função roda fora da
  VPC, com a LabRole, e é assinada nos dois log groups.
- **Duas camadas de JSON.** Com `log_format = "JSON"`, a Lambda embrulha cada `console.log` num objeto próprio
  (`level` em maiúsculas, `requestId`, `message`), e a linha da aplicação vem dentro de `message`, também em JSON.
  O encaminhador abre as duas camadas e os campos da aplicação prevalecem, para que `level = 'warn'` e
  `message = 'autenticação por CPF concluída'` batam com as consultas do dashboard. O access log do gateway já é
  JSON de uma camada só.
- Objetos aninhados viram atributos com ponto (`erro.nome`) até 5 níveis; listas e níveis mais profundos são
  serializados como texto.
- Todo lote recebe `aws.logGroup` e `aws.logStream`, que é por onde o dashboard separa o access log do gateway.
- A mensagem de controle (`CONTROL_MESSAGE`), que a AWS envia ao criar a assinatura, é ignorada.
- Se o New Relic recusar o lote, a função lança erro: a assinatura invoca a Lambda de forma assíncrona, e a
  Lambda tenta de novo.

### `tests/cpf.test.ts`

O caso de CNPJ usa um CNPJ válido — que o validador da API aceitaria, porque trata os dois documentos — para provar
que a Lambda o recusa.

---

## Terraform

### `terraform/api-gateway.tf`

- HTTP API, e não REST API: ~70% mais barato, latência menor e CORS nativo. O que se perde (request validators,
  API keys, WAF direto) não é exigido aqui.
- `aws_lambda_permission.api_gateway` restringe a invocação a **este** gateway (`source_arn`), e não a qualquer API
  da conta.
- O throttling do stage é o freio contra força bruta de CPF na rota de autenticação.
- O access log é JSON de uma linha: é o formato que o New Relic e o CloudWatch Logs Insights consultam por campo,
  sem regex. O campo `path` fica de fora porque a URL crua carrega CPF/CNPJ em `/clientes/cpf-cnpj/:documento`; o
  caminho completo, já mascarado, fica no log da aplicação, ligado à linha do gateway pelo `requestId`.
- As integrações sobrescrevem `x-request-id` com o `requestId` do gateway, para a linha do access log e a do serviço
  terem o mesmo id. A exceção são as rotas de `/pagamentos` (`local.prefixos_com_request_id_do_chamador`): o Mercado
  Pago assina o webhook com o `x-request-id` que ele mesmo envia (manifesto `id:…;request-id:…;ts:…;`), e com o header
  trocado a assinatura nunca confere e o Billing recusa toda notificação com 401. Nessas rotas o serviço usa o id
  recebido do chamador ou gera um próprio.

### `terraform/lambda.tf`

- `reserved_concurrent_executions` limita o estrago de uma força bruta: sem teto, a função escala até o limite da
  conta e despeja toda a carga no OS Service.
- **Sem `vpc_config` desde a Fase 4.** A função só precisava da VPC para alcançar o RDS. Agora chama o Load
  Balancer do OS Service, que é público, e a VPC não tem NAT: dentro dela a função não teria saída.
- `OS_SERVICE_URL`, `INTEGRACAO_API_KEY` e `JWT_CLIENTE_SECRET` são injetados no deploy, em vez de lidos em runtime
  ([ADR-0006](adr/0006-segredos-da-lambda.md)).
- Runtime `nodejs22.x`: o `nodejs20.x` saiu de suporte em 2026.
- `log_format = "JSON"`: o handler já emite JSON; a configuração alinha os logs da plataforma.

### `terraform/newrelic-logs.tf`

- Tudo neste arquivo só é criado quando `new_relic_license_key` está preenchida (secret `NEW_RELIC_LICENSE_KEY`).
  Sem ela, o deploy segue igual e os logs ficam só no CloudWatch.
- O `nonsensitive` no teste da variável existe porque o Terraform não aceita valor sensível em `count` e
  `for_each`. Só o resultado booleano deixa de ser sensível; a chave continua protegida no plan e no state.
- A permissão para `logs.amazonaws.com` invocar o encaminhador é restrita a cada log group assinado (`source_arn`).
- O encaminhador tem log group próprio, que não é assinado, para não reenviar os próprios logs em ciclo.

### `terraform/versions.tf`

- Os parâmetros `/oficina/<env>/{os,execucao,billing}/endpoint` nascem com valor provisório no `oficina-infra-k8s` e
  são preenchidos pelo pipeline de cada serviço quando o Load Balancer sobe. Assim, este Terraform não falha por
  parâmetro inexistente se for aplicado antes de algum serviço.
- `local.rotas` gera duas rotas por prefixo (`ANY /execucoes` e `ANY /execucoes/{proxy+}`): no HTTP API, `{proxy+}`
  não casa com o caminho vazio, e sem a primeira rota `GET /execucoes` cairia no OS Service.

### `terraform/outputs.tf`

Os endpoints são lidos por `insecure_value`, e não por `value`: o provider marca todo `value` do SSM como sensível,
mas são só os hostnames públicos dos Load Balancers, guardados como `String`. Com `value`, o output `backends`
quebrava o plan ("Output refers to sensitive values"), porque `nonsensitive()` no mapa não remove a marca dos
elementos.

### `terraform/api-gateway.tf` — rotas da Fase 4 e `gateway_url`

As rotas específicas (`/orcamentos`, `/execucoes`...) têm prioridade sobre `ANY /{proxy+}` no HTTP API, então o OS
Service continua recebendo tudo o que não é de outro serviço. `aws_ssm_parameter.gateway_url` publica a URL do
stage: o Billing a usa como `notification_url` do Mercado Pago, que precisa de HTTPS público.

---

## CI/CD — `.github/workflows/ci-cd.yml`

- `terraform_wrapper: false`: sem o wrapper, `$(terraform output -raw ...)` devolve só o valor; com ele, vêm linhas
  extras, e a URL do smoke test sairia corrompida.
- `TF_VAR_jwt_cliente_secret` vem do secret `JWT_CLIENTE_SECRET`, que é igual ao `JWT_CLIENTE_SECRET` da API e
  diferente do `JWT_SECRET` dela.
- O smoke test roda contra o ambiente recém-publicado: um CPF sintaticamente inválido deve devolver 422. Isso prova
  que gateway → Lambda está de pé sem depender de haver cliente cadastrado no banco.
- As actions são fixadas por SHA de commit, com a versão legível no comentário `# vX.Y.Z` ao lado de cada `uses:`.
  O `.github/dependabot.yml` mantém os SHAs atualizados; sem ele, o pin congelaria as actions para sempre.

## `.gitignore`

Além do usual, ignora o state do Terraform e o plano salvo por `terraform plan -out`, que contém valores sensíveis.
