import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { limparCPF, mascararCPF, validarCPF } from './cpf.js';
import { buscarClientePorCPF } from './db.js';
import { emitirToken } from './token.js';
import { log, type ContextoLog } from './logger.js';

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
      log.warn('CPF reprovado na validação de dígito verificador', {
        ...ctx,
        cpf: mascararCPF(cpf),
      });
      return erro({ status: 422, codigo: 'CPF_INVALID', mensagem: 'CPF inválido' }, correlationId);
    }

    const cliente = await buscarClientePorCPF(cpf);

    if (!cliente) {
      log.warn('cliente não encontrado', { ...ctx, cpf: mascararCPF(cpf) });
      return erro(
        { status: 404, codigo: 'CLIENT_NOT_FOUND', mensagem: 'Cliente não cadastrado' },
        correlationId,
      );
    }

    if (!cliente.ativo) {
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
