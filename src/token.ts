import jwt from 'jsonwebtoken';
import type { ClienteAutenticavel } from './db.js';

export interface PayloadCliente {
  sub: string;
  role: 'CLIENTE';
  cpf: string;
  nome: string;
  email?: string;
}

export function emitirToken(
  cliente: ClienteAutenticavel,
  cpf: string,
  segredo: string,
  expiraEm: string,
): { token: string; expiresIn: string } {
  const payload: PayloadCliente = {
    sub: cliente.id,
    role: 'CLIENTE',
    cpf,
    nome: cliente.nome,
    ...(cliente.email ? { email: cliente.email } : {}),
  };

  const token = jwt.sign(payload, segredo, {
    expiresIn: expiraEm as jwt.SignOptions['expiresIn'],
    issuer: 'oficina-auth-lambda',
  });

  return { token, expiresIn: expiraEm };
}
