import { beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';

const buscarClientePorCPF = vi.fn();
vi.mock('../src/db.js', () => ({ buscarClientePorCPF }));

const { handler } = await import('../src/handler.js');

const SEGREDO = 'segredo-de-teste-com-pelo-menos-32-caracteres';
const CPF_VALIDO = '52998224725';

const contexto = { awsRequestId: 'req-aws-1' } as Context;

function evento(body: unknown, headers: Record<string, string> = {}): APIGatewayProxyEventV2 {
  return {
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers,
    requestContext: {
      requestId: 'req-apigw-1',
      http: { method: 'POST', path: '/auth/cpf' },
    },
  } as unknown as APIGatewayProxyEventV2;
}

function corpo(res: Awaited<ReturnType<typeof handler>>) {
  return JSON.parse((res as { body: string }).body);
}

function status(res: Awaited<ReturnType<typeof handler>>) {
  return (res as { statusCode: number }).statusCode;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_CLIENTE_SECRET = SEGREDO;
  process.env.JWT_EXPIRES_IN = '8h';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /auth/cpf — passo 1: validação do CPF', () => {
  it('devolve 400 quando o corpo não é JSON', async () => {
    const res = await handler(evento('{nao-e-json'), contexto);
    expect(status(res)).toBe(400);
    expect(corpo(res).code).toBe('INVALID_BODY');
  });

  it('devolve 400 quando o campo cpf está ausente', async () => {
    const res = await handler(evento({}), contexto);
    expect(status(res)).toBe(400);
    expect(corpo(res).code).toBe('CPF_REQUIRED');
  });

  it('devolve 422 para CPF com dígito verificador inválido', async () => {
    const res = await handler(evento({ cpf: '52998224726' }), contexto);
    expect(status(res)).toBe(422);
    expect(corpo(res).code).toBe('CPF_INVALID');
  });

  it('não consulta o banco quando o CPF é inválido', async () => {
    await handler(evento({ cpf: '11111111111' }), contexto);
    expect(buscarClientePorCPF).not.toHaveBeenCalled();
  });

  it('aceita CPF com máscara e normaliza antes de consultar', async () => {
    buscarClientePorCPF.mockResolvedValue({ id: 'c1', nome: 'Ana', email: null, ativo: true });
    await handler(evento({ cpf: '529.982.247-25' }), contexto);
    expect(buscarClientePorCPF).toHaveBeenCalledWith(CPF_VALIDO);
  });
});

describe('POST /auth/cpf — passo 2: existência e status do cliente', () => {
  it('devolve 404 quando o cliente não existe', async () => {
    buscarClientePorCPF.mockResolvedValue(null);
    const res = await handler(evento({ cpf: CPF_VALIDO }), contexto);
    expect(status(res)).toBe(404);
    expect(corpo(res).code).toBe('CLIENT_NOT_FOUND');
  });

  it('devolve 403 — e não 404 — quando o cliente existe mas está inativo', async () => {
    buscarClientePorCPF.mockResolvedValue({ id: 'c1', nome: 'Ana', email: null, ativo: false });
    const res = await handler(evento({ cpf: CPF_VALIDO }), contexto);
    expect(status(res)).toBe(403);
    expect(corpo(res).code).toBe('CLIENT_INACTIVE');
  });

  it('devolve 503 quando o banco está inacessível', async () => {
    buscarClientePorCPF.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await handler(evento({ cpf: CPF_VALIDO }), contexto);
    expect(status(res)).toBe(503);
    expect(corpo(res).code).toBe('AUTH_UNAVAILABLE');
  });
});

describe('POST /auth/cpf — passo 3: emissão do token', () => {
  beforeEach(() => {
    buscarClientePorCPF.mockResolvedValue({
      id: 'cliente-uuid',
      nome: 'Ana Souza',
      email: 'ana@example.com',
      ativo: true,
    });
  });

  it('devolve 200 com um JWT verificável pelo segredo do emissor de clientes', async () => {
    const res = await handler(evento({ cpf: CPF_VALIDO }), contexto);
    expect(status(res)).toBe(200);

    const { token } = corpo(res);
    const payload = jwt.verify(token, SEGREDO) as Record<string, unknown>;

    expect(payload.sub).toBe('cliente-uuid');
    expect(payload.role).toBe('CLIENTE');
    expect(payload.cpf).toBe(CPF_VALIDO);
    expect(payload.nome).toBe('Ana Souza');
    expect(payload.email).toBe('ana@example.com');
    expect(payload.iss).toBe('oficina-auth-lambda');
  });

  it('omite o claim email quando o cliente não tem e-mail cadastrado', async () => {
    buscarClientePorCPF.mockResolvedValue({ id: 'c2', nome: 'Bruno', email: null, ativo: true });
    const res = await handler(evento({ cpf: CPF_VALIDO }), contexto);

    const payload = jwt.verify(corpo(res).token, SEGREDO) as Record<string, unknown>;
    expect(payload).not.toHaveProperty('email');
  });

  it('nunca devolve o CPF nem dados sensíveis no corpo da resposta', async () => {
    const res = await handler(evento({ cpf: CPF_VALIDO }), contexto);
    const body = corpo(res);

    expect(body.cliente).toEqual({ id: 'cliente-uuid', nome: 'Ana Souza' });
    expect(JSON.stringify(body.cliente)).not.toContain(CPF_VALIDO);
  });

  it('devolve 500 quando JWT_CLIENTE_SECRET não está configurado', async () => {
    delete process.env.JWT_CLIENTE_SECRET;
    const res = await handler(evento({ cpf: CPF_VALIDO }), contexto);
    expect(status(res)).toBe(500);
    expect(corpo(res).code).toBe('MISCONFIGURED');
  });
});

describe('correlação de requisições', () => {
  it('honra o x-request-id enviado pelo chamador e o devolve na resposta', async () => {
    buscarClientePorCPF.mockResolvedValue({ id: 'c1', nome: 'Ana', email: null, ativo: true });
    const res = await handler(
      evento({ cpf: CPF_VALIDO }, { 'x-request-id': 'trace-externo' }),
      contexto,
    );

    expect((res as { headers: Record<string, string> }).headers['x-request-id']).toBe(
      'trace-externo',
    );
  });

  it('cai para o requestId do API Gateway quando o header está ausente', async () => {
    buscarClientePorCPF.mockResolvedValue({ id: 'c1', nome: 'Ana', email: null, ativo: true });
    const res = await handler(evento({ cpf: CPF_VALIDO }), contexto);

    expect((res as { headers: Record<string, string> }).headers['x-request-id']).toBe(
      'req-apigw-1',
    );
  });

  it('devolve o id de correlação também nas respostas de erro', async () => {
    const res = await handler(
      evento({ cpf: 'invalido' }, { 'x-request-id': 'trace-erro' }),
      contexto,
    );

    expect(status(res)).toBe(422);
    expect((res as { headers: Record<string, string> }).headers['x-request-id']).toBe('trace-erro');
  });
});
