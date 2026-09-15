import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { CloudWatchLogsDecodedData, CloudWatchLogsEvent } from 'aws-lambda';
import { converterEvento, handler, montarLote } from '../src/encaminhador-logs.js';

const LICENCA = 'licenca-de-teste-NRAL';
const MOMENTO = 1_757_937_600_000;

function linha(message: string) {
  return { id: 'evento-1', timestamp: MOMENTO, message };
}

function dados(campos: Partial<CloudWatchLogsDecodedData> = {}): CloudWatchLogsDecodedData {
  return {
    owner: '123456789012',
    logGroup: '/aws/lambda/oficina-prod-auth',
    logStream: '2026/09/15/[$LATEST]abc',
    subscriptionFilters: ['oficina-prod-new-relic-lambda'],
    messageType: 'DATA_MESSAGE',
    logEvents: [linha('linha simples')],
    ...campos,
  };
}

function eventoCloudWatch(conteudo: CloudWatchLogsDecodedData): CloudWatchLogsEvent {
  return { awslogs: { data: gzipSync(JSON.stringify(conteudo)).toString('base64') } };
}

describe('converterEvento', () => {
  it('usa os campos da linha da aplicação dentro do envelope JSON da Lambda', () => {
    const aplicacao = {
      timestamp: '2026-09-15T12:00:00.000Z',
      level: 'warn',
      service: 'oficina-auth-lambda',
      message: 'cliente inativo',
      requestId: 'req-1',
      correlationId: 'corr-1',
      clienteId: 'cli-1',
    };
    const envelope = {
      timestamp: '2026-09-15T12:00:00.000Z',
      level: 'WARN',
      requestId: 'req-1',
      message: JSON.stringify(aplicacao),
    };

    const log = converterEvento(linha(JSON.stringify(envelope)));

    expect(log.timestamp).toBe(MOMENTO);
    expect(log.message).toBe('cliente inativo');
    expect(log.attributes).toMatchObject({
      level: 'warn',
      service: 'oficina-auth-lambda',
      correlationId: 'corr-1',
      clienteId: 'cli-1',
    });
    expect(log.attributes).not.toHaveProperty('timestamp');
    expect(log.attributes).not.toHaveProperty('message');
  });

  it('achata objetos aninhados, serializa listas e descarta nulos', () => {
    const envelope = {
      level: 'ERROR',
      message: {
        level: 'error',
        message: 'falha',
        erro: { nome: 'Error', mensagem: 'boom' },
        tags: ['a', 'b'],
        vazio: null,
      },
    };

    const log = converterEvento(linha(JSON.stringify(envelope)));

    expect(log.message).toBe('falha');
    expect(log.attributes).toMatchObject({
      level: 'error',
      'erro.nome': 'Error',
      'erro.mensagem': 'boom',
      tags: '["a","b"]',
    });
    expect(log.attributes).not.toHaveProperty('vazio');
  });

  it('serializa como texto o que passa da profundidade máxima', () => {
    const profundo = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };

    const log = converterEvento(linha(JSON.stringify(profundo)));

    expect(log.attributes['a.b.c.d.e.f']).toBe('{"g":1}');
  });

  it('transforma o access log do gateway em atributos', () => {
    const acesso = {
      requestId: 'r-1',
      status: '200',
      routeKey: 'POST /auth/cpf',
      latenciaMs: '35',
      ativo: true,
    };
    const bruta = JSON.stringify(acesso);

    const log = converterEvento(linha(bruta));

    expect(log.message).toBe(bruta);
    expect(log.attributes).toEqual(acesso);
  });

  it('usa o tipo do evento de plataforma como mensagem', () => {
    const plataforma = {
      time: '2026-09-15T12:00:00.000Z',
      type: 'platform.report',
      record: { metrics: { durationMs: 12.5 } },
    };

    const log = converterEvento(linha(JSON.stringify(plataforma)));

    expect(log.message).toBe('platform.report');
    expect(log.attributes['record.metrics.durationMs']).toBe(12.5);
  });

  it('mantém a mensagem do envelope quando ela não é JSON', () => {
    const log = converterEvento(
      linha(JSON.stringify({ level: 'INFO', message: 'texto do runtime' })),
    );

    expect(log.message).toBe('texto do runtime');
    expect(log.attributes).toEqual({ level: 'INFO' });
  });

  it('usa a linha bruta quando o envelope não tem mensagem de texto', () => {
    const bruta = JSON.stringify({ level: 'INFO', message: 42 });

    const log = converterEvento(linha(bruta));

    expect(log.message).toBe(bruta);
    expect(log.attributes).toEqual({ level: 'INFO' });
  });

  it('mantém linhas de texto e JSON inválido como estão', () => {
    expect(converterEvento(linha('START RequestId: abc'))).toEqual({
      timestamp: MOMENTO,
      message: 'START RequestId: abc',
      attributes: {},
    });
    expect(converterEvento(linha('{quebrado')).attributes).toEqual({});
  });
});

describe('montarLote', () => {
  it('identifica a origem de todas as linhas do lote', () => {
    const conteudo = dados({ logEvents: [linha('a'), linha('b')] });

    const [lote] = montarLote(conteudo);

    expect(lote.common.attributes).toEqual({
      'aws.logGroup': '/aws/lambda/oficina-prod-auth',
      'aws.logStream': '2026/09/15/[$LATEST]abc',
      'aws.accountId': '123456789012',
      'plugin.type': 'oficina-encaminhador-logs',
    });
    expect(lote.logs).toHaveLength(2);
  });
});

describe('handler', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.NEW_RELIC_LICENSE_KEY = LICENCA;
    delete process.env.NEW_RELIC_LOG_API;
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEW_RELIC_LICENSE_KEY;
    delete process.env.NEW_RELIC_LOG_API;
  });

  it('envia o lote compactado à Log API com a license key', async () => {
    const conteudo = dados({ logEvents: [linha('a'), linha('b')] });

    const resultado = await handler(eventoCloudWatch(conteudo));

    expect(resultado).toEqual({ enviados: 2 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://log-api.newrelic.com/log/v1');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'api-key': LICENCA, 'content-encoding': 'gzip' });
    expect(JSON.parse(gunzipSync(init.body as Buffer).toString('utf8'))).toEqual(
      montarLote(conteudo),
    );
  });

  it('usa o endpoint configurado', async () => {
    process.env.NEW_RELIC_LOG_API = 'https://log-api.eu.newrelic.com/log/v1';

    await handler(eventoCloudWatch(dados()));

    expect(fetchMock.mock.calls[0][0]).toBe('https://log-api.eu.newrelic.com/log/v1');
  });

  it('ignora a mensagem de controle enviada ao criar a assinatura', async () => {
    const resultado = await handler(eventoCloudWatch(dados({ messageType: 'CONTROL_MESSAGE' })));

    expect(resultado).toEqual({ enviados: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignora lotes vazios', async () => {
    const resultado = await handler(eventoCloudWatch(dados({ logEvents: [] })));

    expect(resultado).toEqual({ enviados: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falha quando o New Relic recusa o lote, para a Lambda tentar de novo', async () => {
    fetchMock.mockResolvedValue(new Response('chave inválida', { status: 403 }));

    await expect(handler(eventoCloudWatch(dados()))).rejects.toThrow('HTTP 403');
  });

  it('falha sem license key', async () => {
    delete process.env.NEW_RELIC_LICENSE_KEY;

    await expect(handler(eventoCloudWatch(dados()))).rejects.toThrow('NEW_RELIC_LICENSE_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
