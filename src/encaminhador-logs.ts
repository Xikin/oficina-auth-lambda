import { gunzipSync, gzipSync } from 'node:zlib';
import type {
  CloudWatchLogsDecodedData,
  CloudWatchLogsEvent,
  CloudWatchLogsLogEvent,
} from 'aws-lambda';

type ValorAtributo = string | number | boolean;
type Objeto = Record<string, unknown>;

export interface LogNewRelic {
  timestamp: number;
  message: string;
  attributes: Record<string, ValorAtributo>;
}

export interface LoteNewRelic {
  common: { attributes: Record<string, string> };
  logs: LogNewRelic[];
}

const LOG_API_PADRAO = 'https://log-api.newrelic.com/log/v1';
const PROFUNDIDADE_MAXIMA = 5;
const CAMPOS_RESERVADOS = new Set(['message', 'timestamp']);

function ehObjeto(valor: unknown): valor is Objeto {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

function interpretarJson(valor: unknown): Objeto | null {
  if (ehObjeto(valor)) return valor;
  if (typeof valor !== 'string' || !valor.trimStart().startsWith('{')) return null;
  try {
    const conteudo: unknown = JSON.parse(valor);
    return ehObjeto(conteudo) ? conteudo : null;
  } catch {
    return null;
  }
}

function semCamposReservados(objeto: Objeto | null): Objeto {
  return Object.fromEntries(
    Object.entries(objeto ?? {}).filter(([chave]) => !CAMPOS_RESERVADOS.has(chave)),
  );
}

function achatar(
  objeto: Objeto,
  prefixo = '',
  profundidade = 0,
  destino: Record<string, ValorAtributo> = {},
): Record<string, ValorAtributo> {
  for (const [chave, valor] of Object.entries(objeto)) {
    const nome = prefixo ? `${prefixo}.${chave}` : chave;
    if (valor === null || valor === undefined) continue;
    if (typeof valor === 'string' || typeof valor === 'number' || typeof valor === 'boolean') {
      destino[nome] = valor;
    } else if (ehObjeto(valor) && profundidade < PROFUNDIDADE_MAXIMA) {
      achatar(valor, nome, profundidade + 1, destino);
    } else {
      destino[nome] = JSON.stringify(valor);
    }
  }
  return destino;
}

function mensagemDe(bruta: string, externo: Objeto | null, interno: Objeto | null): string {
  if (typeof interno?.message === 'string') return interno.message;
  if (typeof externo?.message === 'string') return externo.message;
  if (typeof externo?.type === 'string') return externo.type;
  return bruta;
}

export function converterEvento(evento: CloudWatchLogsLogEvent): LogNewRelic {
  const externo = interpretarJson(evento.message);
  const interno = externo ? interpretarJson(externo.message) : null;
  return {
    timestamp: evento.timestamp,
    message: mensagemDe(evento.message, externo, interno),
    attributes: achatar({ ...semCamposReservados(externo), ...semCamposReservados(interno) }),
  };
}

export function montarLote(dados: CloudWatchLogsDecodedData): LoteNewRelic[] {
  return [
    {
      common: {
        attributes: {
          'aws.logGroup': dados.logGroup,
          'aws.logStream': dados.logStream,
          'aws.accountId': dados.owner,
          'plugin.type': 'oficina-encaminhador-logs',
        },
      },
      logs: dados.logEvents.map(converterEvento),
    },
  ];
}

export function decodificar(evento: CloudWatchLogsEvent): CloudWatchLogsDecodedData {
  return JSON.parse(gunzipSync(Buffer.from(evento.awslogs.data, 'base64')).toString('utf8'));
}

export async function handler(evento: CloudWatchLogsEvent): Promise<{ enviados: number }> {
  const licenca = process.env.NEW_RELIC_LICENSE_KEY;
  if (!licenca) throw new Error('NEW_RELIC_LICENSE_KEY não configurada no encaminhador');

  const dados = decodificar(evento);
  if (dados.messageType !== 'DATA_MESSAGE' || dados.logEvents.length === 0) {
    return { enviados: 0 };
  }

  const resposta = await fetch(process.env.NEW_RELIC_LOG_API || LOG_API_PADRAO, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
      'api-key': licenca,
    },
    body: gzipSync(JSON.stringify(montarLote(dados))),
  });

  if (!resposta.ok) {
    throw new Error(`New Relic recusou o lote (HTTP ${resposta.status}): ${await resposta.text()}`);
  }
  return { enviados: dados.logEvents.length };
}
