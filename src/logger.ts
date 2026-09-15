type Nivel = 'info' | 'warn' | 'error';

export interface ContextoLog {
  requestId: string;
  correlationId?: string;
  [campo: string]: unknown;
}

function emitir(
  nivel: Nivel,
  mensagem: string,
  contexto: ContextoLog,
  extra?: Record<string, unknown>,
) {
  const linha = JSON.stringify({
    timestamp: new Date().toISOString(),
    level: nivel,
    service: 'oficina-auth-lambda',
    env: process.env.APP_ENV ?? 'prod',
    message: mensagem,
    ...contexto,
    ...extra,
  });

  if (nivel === 'error' || nivel === 'warn') console.error(linha);
  else console.log(linha);
}

export const log = {
  info: (msg: string, ctx: ContextoLog, extra?: Record<string, unknown>) =>
    emitir('info', msg, ctx, extra),
  warn: (msg: string, ctx: ContextoLog, extra?: Record<string, unknown>) =>
    emitir('warn', msg, ctx, extra),
  error: (msg: string, ctx: ContextoLog, erro?: unknown) =>
    emitir('error', msg, ctx, {
      erro:
        erro instanceof Error
          ? { nome: erro.name, mensagem: erro.message, stack: erro.stack }
          : { mensagem: String(erro) },
    }),
};
