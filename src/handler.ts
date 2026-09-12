import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { limparCPF, mascararCPF, validarCPF } from './cpf.js';
import { buscarClientePorCPF } from './db.js';
import { emitirToken } from './token.js';
import { log, type ContextoLog } from './logger.js';

/**
 * POST /auth/cpf
 *
 * Os três passos exigidos pela Fase 3, nesta ordem:
 *   1. valida o CPF (dígito verificador) — falha antes de tocar no banco;
 *   2. consulta existência e status do cliente na base;
 *   3. gera e devolve um JWT válido para as APIs protegidas.
 */

interface Falha {
  status: number;
  codigo: string;
  mensagem: string;
}

function resposta(status: number, corpo: unknown, correlationId: string): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: {
      'content-type': 'application/json',
      // Devolvido para que o cliente consiga citar o id ao reportar um problema,
      // e para que o New Relic ligue esta resposta às linhas de log.
      'x-request-id': correlationId,
      'cache-control': 'no-store',
    },
    body: JSON.stringify(corpo),
  };
}

function erro(f: Falha, correlationId: string): APIGatewayProxyResultV2 {
  return resposta(
    f.status,
    { statusCode: f.status, code: f.codigo, message: f.mensagem },
    correlationId,
  );
}

export async function handler(
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<APIGatewayProxyResultV2> {
  // Correlação ponta a ponta: honra o x-request-id que o chamador mandou e,
  // na ausência dele, cai para o id que o API Gateway já gerou.
  const correlationId =
    event.headers?.['x-request-id'] ??
    event.headers?.['X-Request-Id'] ??
    event.requestContext?.requestId ??
    context.awsRequestId;

  const ctx: ContextoLog = {
    requestId: context.awsRequestId,
    correlationId,
    rota: `${event.requestContext?.http?.method} ${event.requestContext?.http?.path}`,
  };

  const inicio = Date.now();

  try {
    // ---- Passo 1: validar o CPF ------------------------------------------
    let corpo: { cpf?: unknown };
    try {
      corpo = JSON.parse(event.body ?? '{}');
    } catch {
      log.warn('corpo da requisição não é JSON válido', ctx);
      return erro(
        { status: 400, codigo: 'INVALID_BODY', mensagem: 'Corpo da requisição deve ser JSON' },
        correlationId,
      );
    }

    if (typeof corpo.cpf !== 'string' || corpo.cpf.trim() === '') {
      log.warn('campo cpf ausente', ctx);
      return erro(
        { status: 400, codigo: 'CPF_REQUIRED', mensagem: 'Informe o campo cpf' },
        correlationId,
      );
    }

    const cpf = limparCPF(corpo.cpf);

    if (!validarCPF(cpf)) {
      // 422: a requisição está bem formada, o CPF é que não é válido.
      log.warn('CPF reprovado na validação de dígito verificador', {
        ...ctx,
        cpf: mascararCPF(cpf),
      });
      return erro({ status: 422, codigo: 'CPF_INVALID', mensagem: 'CPF inválido' }, correlationId);
    }

    // ---- Passo 2: consultar existência e status --------------------------
    const cliente = await buscarClientePorCPF(cpf);

    if (!cliente) {
      log.warn('cliente não encontrado', { ...ctx, cpf: mascararCPF(cpf) });
      return erro(
        { status: 404, codigo: 'CLIENT_NOT_FOUND', mensagem: 'Cliente não cadastrado' },
        correlationId,
      );
    }

    if (!cliente.ativo) {
      // 403 e não 404: o cliente existe, mas está inativo. Distinguir os dois
      // casos é o que o requisito chama de "consultar existência E status".
      log.warn('cliente inativo', { ...ctx, clienteId: cliente.id });
      return erro(
        {
          status: 403,
          codigo: 'CLIENT_INACTIVE',
          mensagem: 'Cadastro inativo. Procure a oficina.',
        },
        correlationId,
      );
    }

    // ---- Passo 3: emitir o token -----------------------------------------
    // Segredo exclusivo do emissor de clientes. NÃO é o JWT_SECRET da API: com
    // um segredo compartilhado, quem lesse a configuração desta função forjaria
    // tokens de ADMIN (ADR-0011 em oficina-mvp).
    const segredo = process.env.JWT_CLIENTE_SECRET;
    if (!segredo) {
      log.error('JWT_CLIENTE_SECRET ausente na configuração da função', ctx, null);
      return erro(
        { status: 500, codigo: 'MISCONFIGURED', mensagem: 'Erro interno do servidor' },
        correlationId,
      );
    }

    const { token, expiresIn } = emitirToken(
      cliente,
      cpf,
      segredo,
      process.env.JWT_EXPIRES_IN ?? '8h',
    );

    log.info('autenticação por CPF concluída', {
      ...ctx,
      clienteId: cliente.id,
      duracaoMs: Date.now() - inicio,
    });

    return resposta(
      200,
      {
        token,
        expiresIn,
        cliente: { id: cliente.id, nome: cliente.nome },
      },
      correlationId,
    );
  } catch (e) {
    // Falha de rede/timeout com o RDS cai aqui. 503 sinaliza ao chamador que
    // vale tentar de novo, ao contrário de um 500 genérico.
    log.error(
      'falha ao processar autenticação por CPF',
      { ...ctx, duracaoMs: Date.now() - inicio },
      e,
    );
    return erro(
      {
        status: 503,
        codigo: 'AUTH_UNAVAILABLE',
        mensagem: 'Serviço de autenticação temporariamente indisponível',
      },
      correlationId,
    );
  }
}
