export interface ClienteAutenticavel {
  id: string;
  nome: string;
  email: string | null;
  ativo: boolean;
}

export class OsServiceIndisponivelError extends Error {
  constructor(detalhe: string) {
    super(`OS Service indisponível: ${detalhe}`);
    this.name = 'OsServiceIndisponivelError';
  }
}

function configuracao() {
  const url = process.env.OS_SERVICE_URL;
  const chave = process.env.INTEGRACAO_API_KEY;
  if (!url || !chave) throw new Error('OS_SERVICE_URL e INTEGRACAO_API_KEY são obrigatórias');
  return { url: url.replace(/\/$/, ''), chave };
}

export async function buscarClientePorCPF(
  cpf: string,
  requestId?: string,
): Promise<ClienteAutenticavel | null> {
  const { url, chave } = configuracao();

  let resposta: Response;
  try {
    resposta = await fetch(`${url}/integracao/clientes/identificar`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': chave,
        ...(requestId && { 'x-request-id': requestId }),
      },
      body: JSON.stringify({ cpf }),
      signal: AbortSignal.timeout(Number(process.env.OS_SERVICE_TIMEOUT_MS ?? 3000)),
    });
  } catch (erro) {
    throw new OsServiceIndisponivelError(erro instanceof Error ? erro.message : String(erro));
  }

  if (resposta.status === 404) return null;
  if (!resposta.ok) throw new OsServiceIndisponivelError(`HTTP ${resposta.status}`);
  return (await resposta.json()) as ClienteAutenticavel;
}
