import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buscarClientePorCPF, OsServiceIndisponivelError } from '../src/clientes.js';

const resposta = (status: number, corpo: unknown = {}) =>
  ({ ok: status < 400, status, json: async () => corpo }) as Response;

beforeEach(() => {
  process.env.OS_SERVICE_URL = 'http://os.interno/';
  process.env.INTEGRACAO_API_KEY = 'chave-de-integracao';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OS_SERVICE_URL;
  delete process.env.INTEGRACAO_API_KEY;
});

describe('buscarClientePorCPF', () => {
  it('consulta o OS Service com a chave de integração e repassa o request id', async () => {
    const cliente = { id: 'c1', nome: 'Ana', email: null, ativo: true };
    const fetch = vi.fn().mockResolvedValue(resposta(200, cliente));
    vi.stubGlobal('fetch', fetch);

    expect(await buscarClientePorCPF('52998224725', 'req-1')).toEqual(cliente);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://os.interno/integracao/clientes/identificar');
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'x-api-key': 'chave-de-integracao',
      'x-request-id': 'req-1',
    });
    expect(JSON.parse(init.body)).toEqual({ cpf: '52998224725' });
  });

  it('devolve null quando o cliente não existe', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resposta(404)));
    expect(await buscarClientePorCPF('52998224725')).toBeNull();
  });

  it('falha de rede ou status inesperado vira OsServiceIndisponivelError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resposta(401)));
    await expect(buscarClientePorCPF('1')).rejects.toThrow(OsServiceIndisponivelError);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    await expect(buscarClientePorCPF('1')).rejects.toThrow(/timeout/);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('texto'));
    await expect(buscarClientePorCPF('1')).rejects.toThrow(/texto/);
  });

  it('exige a configuração da integração', async () => {
    delete process.env.INTEGRACAO_API_KEY;
    await expect(buscarClientePorCPF('1')).rejects.toThrow(/INTEGRACAO_API_KEY/);
  });
});
